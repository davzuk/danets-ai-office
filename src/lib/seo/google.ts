// Google Search Console and Business Profile reads for SEO (Phase 3,
// workstream U). Uses the tenant's Google connection. The mapping helpers
// are pure, so tests can feed them recorded responses.

import { getAccessToken } from "@/lib/connections/tokens";
import { providerFetch } from "@/lib/connections/http";
import { OAuthProviderError } from "@/lib/connections/types";

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const BUSINESS_PROFILE_SCOPE = "https://www.googleapis.com/auth/business.manage";
/** Asked for when a tenant connects Google from SEO → Setup. */
export const GOOGLE_SEO_SCOPES = [SEARCH_CONSOLE_SCOPE, BUSINESS_PROFILE_SCOPE];

const SEARCH_CONSOLE = "https://www.googleapis.com/webmasters/v3";
const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";

/** Which SEO features this grant covers. Google lets people untick scopes on the consent screen. */
export function seoScopes(scopes: string | string[]): { searchConsole: boolean; businessProfile: boolean } {
  const granted = new Set(Array.isArray(scopes) ? scopes : scopes.split(" "));
  return {
    // The read-write webmasters scope also covers reads.
    searchConsole: granted.has(SEARCH_CONSOLE_SCOPE) || granted.has("https://www.googleapis.com/auth/webmasters"),
    businessProfile: granted.has(BUSINESS_PROFILE_SCOPE),
  };
}

export interface GoogleRef {
  connectionId: string;
  businessId: string;
}

async function call<T>(ref: GoogleRef, url: string): Promise<T> {
  const token = await getAccessToken(ref.connectionId, ref.businessId);
  return providerFetch<T>(url, { headers: { Authorization: `Bearer ${token}` } });
}

// ─── Search Console ──────────────────────────────────────────────────

/** Permission levels that can read search data. siteUnverifiedUser can't. */
export const READABLE_PERMISSIONS = ["siteOwner", "siteFullUser", "siteRestrictedUser"] as const;

export interface SearchSite {
  siteUrl: string;
  permission: string;
  /** "sc-domain:" properties cover every subdomain and protocol. */
  kind: "domain" | "url_prefix";
  /** For display: the host or domain. */
  label: string;
}

export function toSearchSites(r: { siteEntry?: { siteUrl?: string; permissionLevel?: string }[] } | null): SearchSite[] {
  return (r?.siteEntry ?? [])
    .filter((e): e is { siteUrl: string; permissionLevel: string } => !!e.siteUrl && !!e.permissionLevel)
    .filter((e) => (READABLE_PERMISSIONS as readonly string[]).includes(e.permissionLevel))
    .map((e) => {
      const domain = e.siteUrl.startsWith("sc-domain:");
      let label = e.siteUrl;
      if (domain) label = e.siteUrl.slice("sc-domain:".length);
      else {
        try {
          const u = new URL(e.siteUrl);
          label = u.host + (u.pathname !== "/" ? u.pathname : "");
        } catch {
          // keep the raw value
        }
      }
      return { siteUrl: e.siteUrl, permission: e.permissionLevel, kind: domain ? ("domain" as const) : ("url_prefix" as const), label };
    })
    .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "domain" ? -1 : 1));
}

/** Properties the connected account can read. */
export async function listSearchSites(ref: GoogleRef): Promise<SearchSite[]> {
  return toSearchSites(await call(ref, `${SEARCH_CONSOLE}/sites`));
}

/** One property's current permission, or null when it is no longer readable. */
export async function getSearchSite(ref: GoogleRef, siteUrl: string): Promise<SearchSite | null> {
  const r = await call<{ siteUrl?: string; permissionLevel?: string }>(ref, `${SEARCH_CONSOLE}/sites/${encodeURIComponent(siteUrl)}`);
  return toSearchSites({ siteEntry: [r] })[0] ?? null;
}

// ─── Business Profile ────────────────────────────────────────────────

export interface GbpAccount {
  name: string; // accounts/{id}
  accountName: string;
  type: string;
}

export interface GbpLocation {
  accountName: string;
  locationName: string; // locations/{id}
  title: string;
  address: string | null;
  mapsUri: string | null;
  reviewUri: string | null;
}

interface RawAddress {
  addressLines?: string[];
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  regionCode?: string;
}

export function formatAddress(a: RawAddress | undefined): string | null {
  if (!a) return null;
  const parts = [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode, a.regionCode].map((x) => x?.trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

interface RawLocation {
  name?: string;
  title?: string;
  storefrontAddress?: RawAddress;
  metadata?: { mapsUri?: string; newReviewUri?: string };
}

export function toGbpLocations(accountName: string, r: { locations?: RawLocation[] } | null): GbpLocation[] {
  return (r?.locations ?? [])
    .filter((l): l is typeof l & { name: string } => !!l.name)
    .map((l) => ({
      accountName,
      locationName: l.name,
      title: l.title?.trim() || "Untitled location",
      address: formatAddress(l.storefrontAddress),
      mapsUri: l.metadata?.mapsUri ?? null,
      reviewUri: l.metadata?.newReviewUri ?? null,
    }));
}

const MAX_PAGES = 10;

export async function listGbpAccounts(ref: GoogleRef): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ pageSize: "20", ...(pageToken ? { pageToken } : {}) });
    const r = await call<{ accounts?: { name?: string; accountName?: string; type?: string }[]; nextPageToken?: string }>(ref, `${ACCOUNTS}/accounts?${q}`);
    for (const a of r?.accounts ?? []) if (a.name) out.push({ name: a.name, accountName: a.accountName ?? a.name, type: a.type ?? "" });
    pageToken = r?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const LOCATION_MASK = "name,title,storefrontAddress,metadata";

export async function listGbpLocations(ref: GoogleRef, accountName: string): Promise<GbpLocation[]> {
  if (!/^accounts\/[\w-]+$/.test(accountName)) throw new Error("Invalid account name");
  const out: GbpLocation[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ readMask: LOCATION_MASK, pageSize: "100", ...(pageToken ? { pageToken } : {}) });
    const r = await call<{ locations?: RawLocation[]; nextPageToken?: string }>(ref, `${BUSINESS_INFO}/${accountName}/locations?${q}`);
    out.push(...toGbpLocations(accountName, r));
    pageToken = r?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** One location, as Google has it now. */
export async function getGbpLocation(ref: GoogleRef, accountName: string, locationName: string): Promise<GbpLocation | null> {
  if (!/^locations\/[\w-]+$/.test(locationName)) throw new Error("Invalid location name");
  const r = await call<RawLocation>(ref, `${BUSINESS_INFO}/${locationName}?readMask=${LOCATION_MASK}`);
  return toGbpLocations(accountName, { locations: [r] })[0] ?? null;
}

// ─── Errors ──────────────────────────────────────────────────────────

/**
 * What a failed Google call means for a property or location:
 * - lost_access: the account can no longer see it (403/404)
 * - not_approved: Business Profile API access hasn't been granted to the
 *   platform's Google project (quota 0 shows as 429 or 403 "quota")
 * - retry: anything else (network, 5xx, rate limit)
 */
export function classifyGoogleError(e: unknown): "lost_access" | "not_approved" | "retry" {
  if (!(e instanceof OAuthProviderError)) return "retry";
  const msg = e.message.toLowerCase();
  if (/quota|has not been used in project|is disabled|api not enabled|service_disabled/.test(msg)) return "not_approved";
  if (e.status === 403 || e.status === 404) return "lost_access";
  return "retry";
}

export const NOT_APPROVED_MESSAGE =
  "Google hasn't enabled Business Profile API access for this platform yet. The platform team has applied; locations can be added once Google approves.";
