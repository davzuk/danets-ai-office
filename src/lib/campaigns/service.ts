import "server-only";
// Campaign records (Phase 4, workstream AA): CRUD, linking assets, and
// matching touchpoints to campaigns.

import { Prisma, type Campaign } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { requireQuota } from "@/lib/plan-quota";
import { logger, serializeError } from "@/lib/logger";
import {
  acceptsUtmMatches,
  buildMatchIndex,
  campaignSlug,
  endedAtFor,
  matchCampaign,
  normalizeAliases,
  uniqueSlug,
  type AssetType,
  type MatchableCampaign,
  type assetLinkSchema,
  type createCampaignSchema,
  type updateCampaignSchema,
} from "./rules";

export interface CampaignActor {
  businessId: string;
  userId?: string;
  name: string;
  role: string;
  /** Set when the platform console acts for the tenant. */
  platform?: boolean;
}

const log = (a: CampaignActor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.platform ? undefined : a.userId, userName: a.name, action, module: "campaigns", description, metadata });

function invalid(message: string): never {
  throw new AppError(message, { status: 400, code: "INVALID_REQUEST" });
}

function notFound(): never {
  throw new AppError("Campaign not found.", { status: 404, code: "NOT_FOUND" });
}

function aliasesOf(c: Pick<Campaign, "aliases">): string[] {
  return Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === "string") : [];
}

function toMatchable(c: Pick<Campaign, "id" | "slug" | "aliases" | "status" | "endedAt">): MatchableCampaign {
  return { id: c.id, slug: c.slug, aliases: aliasesOf(c), status: c.status, endedAt: c.endedAt };
}

// ─── Match cache ──────────────────────────────────────────────────────

const CACHE_MS = 60_000;
const matchCache = new Map<string, { at: number; campaigns: MatchableCampaign[] }>();

export function clearCampaignCache(businessId?: string) {
  if (businessId) matchCache.delete(businessId);
  else matchCache.clear();
}

async function matchableCampaigns(businessId: string): Promise<MatchableCampaign[]> {
  const hit = matchCache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.campaigns;
  const rows = await db.campaign.findMany({
    where: { businessId, status: { not: "archived" } },
    select: { id: true, slug: true, aliases: true, status: true, endedAt: true },
  });
  const campaigns = rows.map(toMatchable);
  matchCache.set(businessId, { at: Date.now(), campaigns });
  return campaigns;
}

/**
 * The campaign a new touch belongs to: an explicit id (a campaign's form,
 * booking type or tracked link) wins, then utm_campaign against slugs and
 * aliases. Never throws: attribution must not block a lead.
 */
export async function resolveCampaignId(
  businessId: string,
  opts: { explicit?: string | null; utmCampaign?: string | null; at?: Date }
): Promise<string | null> {
  if (opts.explicit) return opts.explicit;
  if (!opts.utmCampaign) return null;
  try {
    const campaigns = await matchableCampaigns(businessId);
    if (campaigns.length === 0) return null;
    return matchCampaign(buildMatchIndex(campaigns, opts.at ?? new Date()), opts.utmCampaign);
  } catch (e) {
    logger.warn("Campaign match failed; recording the touch without one", { businessId, ...serializeError(e) });
    return null;
  }
}

// ─── Reads ────────────────────────────────────────────────────────────

export interface CampaignCounts {
  touches: number;
  leads: number;
  assets: number;
}

async function countsFor(businessId: string, ids: string[]): Promise<Map<string, CampaignCounts>> {
  const out = new Map<string, CampaignCounts>(ids.map((id) => [id, { touches: 0, leads: 0, assets: 0 }]));
  if (ids.length === 0) return out;
  const [touches, leads, posts, forms, magnets, types, pages] = await Promise.all([
    db.touchpoint.groupBy({ by: ["campaignId"], where: { businessId, campaignId: { in: ids } }, _count: { _all: true } }),
    // Leads whose last touch was this campaign's (last-touch credit, the default).
    db.$queryRaw<{ campaignId: string; n: bigint }[]>`
      SELECT t.campaignId AS campaignId, COUNT(*) AS n
      FROM \`Lead\` l JOIN \`Touchpoint\` t ON t.id = l.lastTouchId
      WHERE l.businessId = ${businessId} AND t.campaignId IN (${Prisma.join(ids)})
      GROUP BY t.campaignId`,
    db.contentPost.groupBy({ by: ["campaignId"], where: { businessId, campaignId: { in: ids } }, _count: { _all: true } }),
    db.leadFormDef.groupBy({ by: ["campaignId"], where: { businessId, campaignId: { in: ids } }, _count: { _all: true } }),
    db.leadMagnet.groupBy({ by: ["campaignId"], where: { businessId, campaignId: { in: ids } }, _count: { _all: true } }),
    db.bookingType.groupBy({ by: ["campaignId"], where: { businessId, campaignId: { in: ids } }, _count: { _all: true } }),
    db.landingPage.groupBy({ by: ["campaignId"], where: { businessId, campaignId: { in: ids } }, _count: { _all: true } }),
  ]);
  for (const r of touches) if (r.campaignId) out.get(r.campaignId)!.touches = r._count._all;
  for (const r of leads) if (out.has(r.campaignId)) out.get(r.campaignId)!.leads = Number(r.n);
  for (const group of [posts, forms, magnets, types, pages]) {
    for (const r of group) if (r.campaignId) out.get(r.campaignId)!.assets += r._count._all;
  }
  return out;
}

export function toCampaignDto(c: Campaign, counts?: CampaignCounts) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    goal: c.goal,
    status: c.status,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    budget: c.budget == null ? null : Number(c.budget),
    targetLeads: c.targetLeads,
    ownerId: c.ownerId,
    notes: c.notes,
    aliases: aliasesOf(c),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    counts: counts ?? { touches: 0, leads: 0, assets: 0 },
  };
}
export type CampaignDto = ReturnType<typeof toCampaignDto>;

export async function listCampaigns(businessId: string, opts: { includeArchived?: boolean } = {}) {
  await ensureTagCampaigns(businessId);
  const rows = await db.campaign.findMany({
    where: { businessId, ...(opts.includeArchived ? {} : { status: { not: "archived" } }) },
    orderBy: [{ updatedAt: "desc" }],
  });
  const counts = await countsFor(businessId, rows.map((r) => r.id));
  return rows.map((r) => toCampaignDto(r, counts.get(r.id)));
}

/** Small list for pickers: id, name, status. */
export async function campaignOptions(businessId: string) {
  await ensureTagCampaigns(businessId);
  return db.campaign.findMany({
    where: { businessId, status: { in: ["draft", "active", "paused"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true },
  });
}

async function findOwn(businessId: string, id: string) {
  const c = await db.campaign.findFirst({ where: { id, businessId } });
  if (!c) notFound();
  return c;
}

export async function getCampaign(businessId: string, id: string) {
  const c = await findOwn(businessId, id);
  const [counts, assets, byKind, byChannel] = await Promise.all([
    countsFor(businessId, [c.id]),
    campaignAssets(businessId, c.id),
    db.touchpoint.groupBy({ by: ["kind"], where: { businessId, campaignId: c.id }, _count: { _all: true } }),
    db.touchpoint.groupBy({ by: ["channel"], where: { businessId, campaignId: c.id }, _count: { _all: true } }),
  ]);
  return {
    campaign: toCampaignDto(c, counts.get(c.id)),
    assets,
    touchesByKind: Object.fromEntries(byKind.map((r) => [r.kind, r._count._all])),
    touchesByChannel: Object.fromEntries(byChannel.map((r) => [r.channel, r._count._all])),
  };
}

export interface AssetRow {
  type: AssetType;
  id: string;
  name: string;
  status: string;
  campaignId: string | null;
}

/** Everything that can be linked, with what it is linked to now. */
export async function campaignAssets(businessId: string, campaignId: string) {
  const [posts, forms, magnets, types, pages] = await Promise.all([
    db.contentPost.findMany({ where: { businessId, status: { not: "archived" } }, select: { id: true, title: true, brief: true, status: true, campaignId: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.leadFormDef.findMany({ where: { businessId, status: "active" }, select: { id: true, name: true, status: true, campaignId: true }, orderBy: { updatedAt: "desc" } }),
    db.leadMagnet.findMany({ where: { businessId }, select: { id: true, title: true, status: true, campaignId: true }, orderBy: { updatedAt: "desc" } }),
    db.bookingType.findMany({ where: { businessId }, select: { id: true, name: true, active: true, campaignId: true }, orderBy: { name: "asc" } }),
    db.landingPage.findMany({ where: { businessId }, select: { id: true, title: true, slug: true, status: true, campaignId: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  const rows: AssetRow[] = [
    ...posts.map((p) => ({ type: "post" as const, id: p.id, name: p.title || p.brief.slice(0, 80), status: p.status, campaignId: p.campaignId })),
    ...forms.map((f) => ({ type: "form" as const, id: f.id, name: f.name, status: f.status, campaignId: f.campaignId })),
    ...magnets.map((m) => ({ type: "magnet" as const, id: m.id, name: m.title, status: m.status, campaignId: m.campaignId })),
    ...types.map((t) => ({ type: "booking_type" as const, id: t.id, name: t.name, status: t.active ? "active" : "inactive", campaignId: t.campaignId })),
    ...pages.map((p) => ({ type: "page" as const, id: p.id, name: p.title || `/${p.slug}`, status: p.status, campaignId: p.campaignId })),
  ];
  return {
    linked: rows.filter((r) => r.campaignId === campaignId),
    available: rows.filter((r) => r.campaignId !== campaignId && r.type !== "page"),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────

async function takenSlugs(businessId: string, exceptId?: string): Promise<Set<string>> {
  const rows = await db.campaign.findMany({ where: { businessId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { slug: true } });
  return new Set(rows.map((r) => r.slug));
}

async function checkOwner(businessId: string, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const u = await db.businessUser.findFirst({ where: { id: ownerId, businessId }, select: { id: true } });
  if (!u) invalid("The owner must be a member of your team.");
}

export async function createCampaign(a: CampaignActor, input: z.infer<typeof createCampaignSchema>) {
  await requireQuota(a.businessId, "campaigns");
  await checkOwner(a.businessId, input.ownerId);
  const taken = await takenSlugs(a.businessId);
  const wanted = input.slug ? campaignSlug(input.slug) : "";
  if (input.slug && !wanted) invalid("The tracking name needs at least one letter or number.");
  if (wanted && taken.has(wanted)) invalid(`Another campaign already uses the tracking name "${wanted}".`);
  const slug = wanted || uniqueSlug(input.name, taken);
  const c = await db.campaign.create({
    data: {
      businessId: a.businessId,
      name: input.name,
      slug,
      goal: input.goal ?? "leads",
      status: input.status ?? "draft",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      budget: input.budget ?? null,
      targetLeads: input.targetLeads ?? null,
      ownerId: input.ownerId ?? null,
      notes: input.notes ?? null,
      aliases: normalizeAliases(input.aliases ?? [], slug),
      createdById: a.platform ? null : a.userId ?? null,
    },
  });
  clearCampaignCache(a.businessId);
  await log(a, "create", `Created campaign "${c.name}"`, { campaignId: c.id });
  return toCampaignDto(c);
}

export async function updateCampaign(a: CampaignActor, id: string, input: z.infer<typeof updateCampaignSchema>) {
  const c = await findOwn(a.businessId, id);
  await checkOwner(a.businessId, input.ownerId);

  // Reopening a campaign counts toward the limit again.
  if (input.status && ["draft", "active", "paused"].includes(input.status) && ["ended", "archived"].includes(c.status)) {
    await requireQuota(a.businessId, "campaigns");
  }

  let slug = c.slug;
  let aliases = input.aliases !== undefined ? input.aliases : aliasesOf(c);
  if (input.slug !== undefined && campaignSlug(input.slug) !== c.slug) {
    const next = campaignSlug(input.slug);
    if (!next) invalid("The tracking name needs at least one letter or number.");
    if ((await takenSlugs(a.businessId, c.id)).has(next)) invalid(`Another campaign already uses the tracking name "${next}".`);
    // Links already out there keep counting: the old name becomes an alias.
    aliases = [c.slug, ...aliases];
    slug = next;
  }

  const startsAt = input.startsAt !== undefined ? input.startsAt : c.startsAt;
  const endsAt = input.endsAt !== undefined ? input.endsAt : c.endsAt;
  if (startsAt && endsAt && endsAt < startsAt) invalid("The end date must be after the start date.");
  const status = input.status ?? c.status;

  const updated = await db.campaign.update({
    where: { id: c.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      slug,
      aliases: normalizeAliases(aliases, slug),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      status,
      endedAt: endedAtFor(status, c),
      startsAt,
      endsAt,
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
      ...(input.targetLeads !== undefined ? { targetLeads: input.targetLeads } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    },
  });
  clearCampaignCache(a.businessId);
  // New names to match (or a reopened campaign): link the last 90 days' unmatched touches now.
  const before = new Set([c.slug, ...aliasesOf(c)]);
  const added = [updated.slug, ...aliasesOf(updated)].some((k) => !before.has(k));
  if (added || (c.status === "archived" && updated.status !== "archived")) await rematchTouches(a.businessId, 90);
  const what = input.status && input.status !== c.status ? `Set campaign "${updated.name}" to ${input.status}` : `Updated campaign "${updated.name}"`;
  await log(a, "update", what, { campaignId: c.id });
  return toCampaignDto(updated);
}

/** Delete a campaign. Linked items and matched touches are kept and unlinked. */
export async function deleteCampaign(a: CampaignActor, id: string) {
  if (a.role !== "admin" && !a.platform) throw new AppError("Only admins can delete campaigns.", { status: 403, code: "FORBIDDEN" });
  const c = await findOwn(a.businessId, id);
  await db.campaign.delete({ where: { id: c.id } });
  clearCampaignCache(a.businessId);
  await log(a, "delete", `Deleted campaign "${c.name}"`, { campaignId: c.id });
  return { ok: true };
}

/** Link (or unlink) a post, form, lead magnet, booking type or page. */
export async function linkAsset(a: CampaignActor, campaignId: string, input: z.infer<typeof assetLinkSchema>) {
  const c = await findOwn(a.businessId, campaignId);
  if (input.type === "page" && !a.platform) {
    throw new AppError("Website pages are linked by the platform team.", { status: 403, code: "FORBIDDEN" });
  }
  if (input.linked && c.status === "archived") invalid("Restore the campaign before adding to it.");
  const where = { id: input.id, businessId: a.businessId };
  const unlinkWhere = { ...where, campaignId: c.id };
  const value = input.linked ? c.id : null;
  const w = input.linked ? where : unlinkWhere;
  let res: Prisma.BatchPayload;
  switch (input.type) {
    case "post":
      res = await db.contentPost.updateMany({ where: w, data: { campaignId: value } });
      break;
    case "form":
      res = await db.leadFormDef.updateMany({ where: w, data: { campaignId: value } });
      break;
    case "magnet":
      res = await db.leadMagnet.updateMany({ where: w, data: { campaignId: value } });
      break;
    case "booking_type":
      res = await db.bookingType.updateMany({ where: w, data: { campaignId: value } });
      break;
    case "page":
      res = await db.landingPage.updateMany({ where: w, data: { campaignId: value } });
      break;
  }
  if (res.count === 0) throw new AppError(input.linked ? "That item wasn't found." : "That item isn't in this campaign.", { status: 404, code: "NOT_FOUND" });
  await log(a, "update", `${input.linked ? "Added" : "Removed"} a ${input.type.replace("_", " ")} ${input.linked ? "to" : "from"} campaign "${c.name}"`, {
    campaignId: c.id,
    assetType: input.type,
    assetId: input.id,
  });
  return campaignAssets(a.businessId, c.id);
}

/** Check a campaign id given by a builder belongs to the business (or clear it). */
export async function ownCampaignId(businessId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const c = await db.campaign.findFirst({ where: { id, businessId }, select: { id: true, status: true } });
  if (!c) invalid("That campaign wasn't found.");
  if (c.status === "archived") invalid("That campaign is archived.");
  return c.id;
}

/** Posts in a draft campaign can't be scheduled yet. */
export async function assertCampaignPublishable(campaignId: string | null | undefined) {
  if (!campaignId) return;
  const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { name: true, status: true } });
  if (c?.status === "draft") {
    throw new AppError(`The campaign "${c.name}" is still a draft. Make it active before scheduling its posts.`, { status: 400, code: "CAMPAIGN_DRAFT" });
  }
}

// ─── Migration and rematching ─────────────────────────────────────────

/**
 * Turn Phase 1's free-text `campaignTag` on posts into campaigns. Runs on
 * the Campaigns list and in the nightly job, and is a no-op once done.
 */
export async function ensureTagCampaigns(businessId: string): Promise<number> {
  const tagged = await db.contentPost.findMany({
    where: { businessId, campaignId: null, campaignTag: { not: null } },
    select: { id: true, campaignTag: true },
  });
  const byTag = new Map<string, { name: string; ids: string[] }>();
  for (const p of tagged) {
    const name = p.campaignTag!.trim();
    const slug = campaignSlug(name);
    if (!slug) continue;
    const entry = byTag.get(slug) ?? { name, ids: [] };
    entry.ids.push(p.id);
    byTag.set(slug, entry);
  }
  if (byTag.size === 0) return 0;

  for (const [slug, { name, ids }] of byTag) {
    // An existing campaign with the same tracking name takes the posts.
    let c = await db.campaign.findUnique({ where: { businessId_slug: { businessId, slug } }, select: { id: true } });
    if (!c) {
      try {
        c = await db.campaign.create({ data: { businessId, name: name.slice(0, 160), slug, status: "active", aliases: [] }, select: { id: true } });
      } catch (e) {
        if ((e as { code?: string })?.code !== "P2002") throw e;
        c = await db.campaign.findUnique({ where: { businessId_slug: { businessId, slug } }, select: { id: true } });
        if (!c) continue;
      }
    }
    await db.contentPost.updateMany({ where: { id: { in: ids }, campaignId: null }, data: { campaignId: c.id } });
  }
  clearCampaignCache(businessId);
  await rematchTouches(businessId, null);
  return byTag.size;
}

/**
 * Link unmatched touches to campaigns by utm_campaign, using each touch's
 * own time for the ended-campaign grace period. `sinceDays` null = all.
 */
export async function rematchTouches(businessId: string, sinceDays: number | null = 90): Promise<number> {
  const rows = await db.campaign.findMany({ where: { businessId, status: { not: "archived" } }, select: { id: true, slug: true, aliases: true, status: true, endedAt: true } });
  if (rows.length === 0) return 0;
  const campaigns = rows.map(toMatchable);
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  // Index ignoring the grace period; each hit is checked against the touch time.
  const index = buildMatchIndex(campaigns.map((c) => ({ ...c, status: c.status === "ended" ? "active" : c.status })));
  const since = sinceDays == null ? undefined : new Date(Date.now() - sinceDays * 86_400_000);

  let matched = 0;
  let cursor: string | undefined;
  for (;;) {
    const touches = await db.touchpoint.findMany({
      where: { businessId, campaignId: null, campaign: { not: null }, ...(since ? { occurredAt: { gte: since } } : {}) },
      select: { id: true, campaign: true, occurredAt: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (touches.length === 0) break;
    cursor = touches[touches.length - 1].id;
    const groups = new Map<string, string[]>();
    for (const t of touches) {
      const id = matchCampaign(index, t.campaign);
      const c = id ? byId.get(id) : undefined;
      if (!c || !acceptsUtmMatches(c, t.occurredAt)) continue;
      groups.set(c.id, [...(groups.get(c.id) ?? []), t.id]);
    }
    for (const [campaignId, ids] of groups) {
      const r = await db.touchpoint.updateMany({ where: { id: { in: ids }, campaignId: null }, data: { campaignId } });
      matched += r.count;
    }
    if (touches.length < 500) break;
  }
  return matched;
}
