import "server-only";
// SEO setup (Phase 3, workstream U): which Search Console property and which
// Business Profile locations belong to a tenant, picked through their Google
// connection, plus the daily check that Danets can still read them.

import type { BusinessLocation, OAuthConnection, SearchProperty } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification, logActivity } from "@/lib/activity";
import { logger, serializeError } from "@/lib/logger";
import { checkQuota, requireQuota } from "@/lib/plan-quota";
import { getConnectionProvider } from "@/lib/connections/registry";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import {
  classifyGoogleError,
  getGbpLocation,
  getSearchSite,
  listGbpAccounts,
  listGbpLocations,
  listSearchSites,
  NOT_APPROVED_MESSAGE,
  seoScopes,
  type GbpLocation,
  type SearchSite,
} from "./google";
import { ensureLocationAccount, mirrorLocationStatus, removeLocationAccount } from "./gbp-account";

export interface Actor {
  businessId: string;
  userId?: string;
  name: string;
}

const log = (a: Actor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.userId, userName: a.name, action, module: "seo", description, metadata });

export type PropertyStatus = "active" | "lost_access" | "error";

// ─── Reading ─────────────────────────────────────────────────────────

export const publicProperty = (p: SearchProperty) => ({
  id: p.id,
  connectionId: p.connectionId,
  siteUrl: p.siteUrl,
  permission: p.permission,
  status: p.status,
  error: p.error,
  lastCheckedAt: p.lastCheckedAt,
  lastSyncedAt: p.lastSyncedAt,
  createdAt: p.createdAt,
});

export const publicLocation = (l: BusinessLocation) => ({
  id: l.id,
  connectionId: l.connectionId,
  accountName: l.accountName,
  locationName: l.locationName,
  title: l.title,
  address: l.address,
  mapsUri: l.mapsUri,
  reviewUri: l.reviewUri,
  status: l.status,
  error: l.error,
  lastCheckedAt: l.lastCheckedAt,
  lastSyncedAt: l.lastSyncedAt,
  createdAt: l.createdAt,
});

const publicConnection = (c: OAuthConnection) => ({
  id: c.id,
  accountName: c.accountName,
  accountEmail: c.accountEmail,
  status: c.status,
  ...seoScopes(c.scopes ?? ""),
});

/** Everything SEO → Setup shows. */
export async function setupData(businessId: string) {
  const [connections, properties, locations, propQuota, locQuota] = await Promise.all([
    db.oAuthConnection.findMany({ where: { businessId, provider: "google" }, orderBy: { createdAt: "asc" } }),
    db.searchProperty.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.businessLocation.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    checkQuota(businessId, "seoProperties", 0),
    checkQuota(businessId, "gbpLocations", 0),
  ]);
  return {
    googleConfigured: !!getConnectionProvider("google")?.isConfigured(process.env),
    connections: connections.map(publicConnection),
    properties: properties.map(publicProperty),
    locations: locations.map(publicLocation),
    limits: { properties: { used: propQuota.used, limit: propQuota.limit }, locations: { used: locQuota.used, limit: locQuota.limit } },
  };
}

/** A Google connection of this tenant that is usable for `need`. */
async function usableConnection(businessId: string, connectionId: string, need: "searchConsole" | "businessProfile") {
  const conn = await db.oAuthConnection.findFirst({ where: { id: connectionId, businessId, provider: "google" } });
  if (!conn) throw new AppError("That Google account isn't connected.", { status: 404, code: "NOT_FOUND" });
  if (conn.status !== "active") throw new AppError("That Google connection needs reconnecting.", { status: 409, code: "CONNECTION_INACTIVE" });
  if (!seoScopes(conn.scopes ?? "")[need]) {
    throw new AppError(
      need === "searchConsole"
        ? "This Google connection didn't grant Search Console access. Reconnect Google and tick Search Console."
        : "This Google connection didn't grant Business Profile access. Reconnect Google and tick Business Profile.",
      { status: 409, code: "MISSING_SCOPE" }
    );
  }
  return conn;
}

/** Turn a Google failure into a message for the person in setup. */
export function googleProblem(e: unknown, what: string): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ConnectionUnavailableError) return new AppError("The Google connection needs reconnecting.", { status: 409, code: "CONNECTION_INACTIVE" });
  const kind = classifyGoogleError(e);
  if (kind === "not_approved") return new AppError(NOT_APPROVED_MESSAGE, { status: 503, code: "GBP_NOT_APPROVED" });
  if (kind === "lost_access") return new AppError(`Google says this account can't see ${what}.`, { status: 403, code: "NO_ACCESS" });
  logger.warn("Google SEO call failed", serializeError(e));
  return new AppError("Google didn't answer just now. Please try again.", { status: 502, code: "GOOGLE_FAILED" });
}

export async function availableSites(businessId: string, connectionId: string): Promise<(SearchSite & { added: boolean })[]> {
  await usableConnection(businessId, connectionId, "searchConsole");
  try {
    const [sites, added] = await Promise.all([
      listSearchSites({ businessId, connectionId }),
      db.searchProperty.findMany({ where: { businessId }, select: { siteUrl: true } }),
    ]);
    const have = new Set(added.map((a) => a.siteUrl));
    return sites.map((s) => ({ ...s, added: have.has(s.siteUrl) }));
  } catch (e) {
    throw googleProblem(e, "Search Console");
  }
}

/** Locations across the account's Business Profile accounts (up to 10 accounts). */
export async function availableLocations(businessId: string, connectionId: string): Promise<(GbpLocation & { added: boolean; accountLabel: string })[]> {
  await usableConnection(businessId, connectionId, "businessProfile");
  try {
    const accounts = (await listGbpAccounts({ businessId, connectionId })).slice(0, 10);
    const lists = await Promise.all(accounts.map((a) => listGbpLocations({ businessId, connectionId }, a.name).then((ls) => ls.map((l) => ({ ...l, accountLabel: a.accountName })))));
    const added = new Set((await db.businessLocation.findMany({ where: { businessId }, select: { locationName: true } })).map((l) => l.locationName));
    return lists.flat().map((l) => ({ ...l, added: added.has(l.locationName) }));
  } catch (e) {
    throw googleProblem(e, "Business Profile");
  }
}

// ─── Changes ─────────────────────────────────────────────────────────

export async function addProperty(a: Actor, input: { connectionId: string; siteUrl: string }) {
  await usableConnection(a.businessId, input.connectionId, "searchConsole");
  const exists = await db.searchProperty.findUnique({ where: { businessId_siteUrl: { businessId: a.businessId, siteUrl: input.siteUrl } } });
  if (exists) throw new AppError("That property is already added.", { status: 409, code: "EXISTS" });
  let site: SearchSite | null;
  try {
    site = await getSearchSite({ businessId: a.businessId, connectionId: input.connectionId }, input.siteUrl);
  } catch (e) {
    throw googleProblem(e, "that property");
  }
  if (!site) throw new AppError("This Google account can't read that property's search data.", { status: 403, code: "NO_ACCESS" });
  await requireQuota(a.businessId, "seoProperties");
  const row = await db.searchProperty.create({
    data: { businessId: a.businessId, connectionId: input.connectionId, siteUrl: site.siteUrl, permission: site.permission, lastCheckedAt: new Date() },
  });
  await log(a, "create", `Added the Search Console property ${site.label}`, { propertyId: row.id });
  return row;
}

export async function removeProperty(a: Actor, id: string) {
  const row = await db.searchProperty.findFirst({ where: { id, businessId: a.businessId } });
  if (!row) throw new AppError("Property not found.", { status: 404, code: "NOT_FOUND" });
  await db.searchProperty.delete({ where: { id: row.id } });
  await log(a, "delete", `Removed the Search Console property ${row.siteUrl}`, { propertyId: row.id });
}

export async function addLocation(a: Actor, input: { connectionId: string; accountName: string; locationName: string }) {
  await usableConnection(a.businessId, input.connectionId, "businessProfile");
  const exists = await db.businessLocation.findUnique({ where: { businessId_locationName: { businessId: a.businessId, locationName: input.locationName } } });
  if (exists) throw new AppError("That location is already added.", { status: 409, code: "EXISTS" });
  let loc: GbpLocation | null;
  try {
    loc = await getGbpLocation({ businessId: a.businessId, connectionId: input.connectionId }, input.accountName, input.locationName);
  } catch (e) {
    throw googleProblem(e, "that location");
  }
  if (!loc) throw new AppError("Location not found.", { status: 404, code: "NOT_FOUND" });
  await requireQuota(a.businessId, "gbpLocations");
  const row = await db.businessLocation.create({
    data: {
      businessId: a.businessId,
      connectionId: input.connectionId,
      accountName: loc.accountName,
      locationName: loc.locationName,
      title: loc.title.slice(0, 300),
      address: loc.address,
      mapsUri: loc.mapsUri,
      reviewUri: loc.reviewUri,
      lastCheckedAt: new Date(),
    },
  });
  await ensureLocationAccount(row);
  await log(a, "create", `Added the Business Profile location ${loc.title}`, { locationId: row.id });
  return row;
}

export async function removeLocation(a: Actor, id: string) {
  const row = await db.businessLocation.findFirst({ where: { id, businessId: a.businessId } });
  if (!row) throw new AppError("Location not found.", { status: 404, code: "NOT_FOUND" });
  await removeLocationAccount(row);
  await db.businessLocation.delete({ where: { id: row.id } });
  await log(a, "delete", `Removed the Business Profile location ${row.title}`, { locationId: row.id });
}

// ─── Health ──────────────────────────────────────────────────────────

export interface CheckOutcome {
  status: PropertyStatus;
  error: string | null;
  /** Transient failure: keep the current status and try again next run. */
  retry?: boolean;
  /** Fresh details to store (permission, title, address…). */
  fields?: Record<string, string | null>;
}

/** What a check failure means for the stored row. Pure. */
export function outcomeForError(e: unknown, what: "property" | "location"): CheckOutcome {
  if (e instanceof ConnectionUnavailableError) return { status: "error", error: "The Google connection needs reconnecting in Integrations." };
  const kind = classifyGoogleError(e);
  if (kind === "not_approved") return { status: "error", error: NOT_APPROVED_MESSAGE };
  if (kind === "lost_access")
    return {
      status: "lost_access",
      error:
        what === "property"
          ? "The connected Google account can no longer read this property. Reconnect Google, or ask the property owner to add that account in Search Console."
          : "The connected Google account can no longer manage this location. Reconnect Google, or ask the profile owner to add that account as a manager.",
    };
  return { status: "error", error: "Google didn't answer the last check.", retry: true };
}

async function applyOutcome(kind: "property" | "location", row: SearchProperty | BusinessLocation, out: CheckOutcome) {
  const data = {
    lastCheckedAt: new Date(),
    ...(out.retry ? {} : { status: out.status, error: out.error }),
    ...(out.fields ?? {}),
  };
  if (kind === "property") await db.searchProperty.update({ where: { id: row.id }, data });
  else {
    await db.businessLocation.update({ where: { id: row.id }, data });
    if (!out.retry) await mirrorLocationStatus(row as BusinessLocation, out.status, out.error);
  }

  // Tell the tenant once, when something that worked stops working.
  if (!out.retry && row.status === "active" && out.status !== "active") {
    const name = kind === "property" ? (row as SearchProperty).siteUrl : (row as BusinessLocation).title;
    await createNotification({
      businessId: row.businessId,
      type: "integration_error",
      title: kind === "property" ? "Search Console property needs attention" : "Business Profile location needs attention",
      message: `${name}: ${out.error}`,
      data: { [kind === "property" ? "propertyId" : "locationId"]: row.id },
    });
  }
}

export async function checkProperty(row: SearchProperty): Promise<CheckOutcome> {
  let out: CheckOutcome;
  try {
    const site = await getSearchSite(row, row.siteUrl);
    out = site
      ? { status: "active", error: null, fields: { permission: site.permission } }
      : { status: "lost_access", error: "The connected Google account no longer has permission to read this property's search data." };
  } catch (e) {
    out = outcomeForError(e, "property");
  }
  await applyOutcome("property", row, out);
  return out;
}

export async function checkLocation(row: BusinessLocation): Promise<CheckOutcome> {
  let out: CheckOutcome;
  try {
    const loc = await getGbpLocation(row, row.accountName, row.locationName);
    out = loc
      ? { status: "active", error: null, fields: { title: loc.title.slice(0, 300), address: loc.address, mapsUri: loc.mapsUri, reviewUri: loc.reviewUri } }
      : { status: "lost_access", error: "Google no longer returns this location." };
  } catch (e) {
    out = outcomeForError(e, "location");
  }
  await applyOutcome("location", row, out);
  return out;
}

/** Check every property and location of one tenant (the "Check now" button and the daily job). */
export async function checkBusiness(businessId: string) {
  const [props, locs] = await Promise.all([db.searchProperty.findMany({ where: { businessId } }), db.businessLocation.findMany({ where: { businessId } })]);
  for (const p of props) await checkProperty(p);
  for (const l of locs) await checkLocation(l);
  return { properties: props.length, locations: locs.length };
}
