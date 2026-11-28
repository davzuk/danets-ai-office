import "server-only";
// Tracked keywords and the opportunities list (Phase 3, workstream Y).
// Keyword history comes from V's stored query rows, so the Keywords tab
// makes no Google calls of its own.

import { z } from "zod";
import type { SearchProperty, SeoOpportunity, TrackedKeyword } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { getEffectiveLimits } from "@/lib/plan-quota";
import { addDaysIso, aggregateByKey, fromIso, lastFinalDay, QUERY_KIND, sumMetrics, toIso } from "./search";
import { expectedCtr, OPPORTUNITY_KINDS, type OpportunityKind, type PageShare } from "./opportunities";
import { pageSuggestions } from "./audit";

export interface SeoActor {
  businessId: string;
  userId?: string;
  name: string;
  role: string;
}

const log = (a: SeoActor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.userId, userName: a.name, action, module: "seo", description, metadata });

const requireAdmin = (a: SeoActor) => {
  if (a.role !== "admin") throw new AppError("Only admins can change SEO settings.", { status: 403, code: "FORBIDDEN" });
};

export const OPPORTUNITY_SUGGEST_FEATURE = "seo_fix";
/** How far back keyword history goes, and the current/previous comparison windows. */
export const HISTORY_DAYS = 84;
export const WINDOW_DAYS = 28;

// ─── Keywords (pure helpers) ─────────────────────────────────────────

/** Search Console reports queries in lower case with single spaces. Pure. */
export function normalizeKeyword(raw: string): string | null {
  const k = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return k && k.length <= 200 ? k : null;
}

/** Split pasted text (one per line, or commas) into distinct keywords. Pure. */
export function parseKeywordList(text: string | string[]): { keywords: string[]; invalid: string[] } {
  const parts = (Array.isArray(text) ? text : text.split(/[\n,]/)).map((p) => p.trim()).filter(Boolean);
  const keywords: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const k = normalizeKeyword(p);
    if (!k) invalid.push(p.slice(0, 60));
    else if (!keywords.includes(k)) keywords.push(k);
  }
  return { keywords, invalid };
}

export interface KeywordRow {
  date: string;
  key: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface KeywordStats {
  clicks: number;
  impressions: number;
  ctr: number;
  /** Impression-weighted average position, null when there were no impressions. */
  position: number | null;
  previousPosition: number | null;
  /** Positive = moved up (a smaller position number). */
  change: number | null;
  /** Average position per week, oldest first; null for weeks with no impressions. */
  weekly: (number | null)[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One keyword's numbers from its stored query rows. `to` is the last day with data. Pure. */
export function keywordStats(rows: KeywordRow[], to: string, windowDays = WINDOW_DAYS, historyDays = HISTORY_DAYS): KeywordStats {
  const from = addDaysIso(to, -(windowDays - 1));
  const prevFrom = addDaysIso(from, -windowDays);
  const cur = sumMetrics(rows.filter((r) => r.date >= from && r.date <= to));
  const prev = sumMetrics(rows.filter((r) => r.date >= prevFrom && r.date < from));
  const position = cur.impressions ? round1(cur.position) : null;
  const previousPosition = prev.impressions ? round1(prev.position) : null;
  const weeks = Math.ceil(historyDays / 7);
  const weekly: (number | null)[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDaysIso(to, -7 * w);
    const start = addDaysIso(end, -6);
    const t = sumMetrics(rows.filter((r) => r.date >= start && r.date <= end));
    weekly.push(t.impressions ? round1(t.position) : null);
  }
  return {
    clicks: cur.clicks,
    impressions: cur.impressions,
    ctr: cur.ctr,
    position,
    previousPosition,
    change: position != null && previousPosition != null ? round1(previousPosition - position) : null,
    weekly,
  };
}

// ─── Reading ─────────────────────────────────────────────────────────

async function pickProperty(businessId: string, propertyId?: string | null) {
  const properties = await db.searchProperty.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
  const property = properties.find((p) => p.id === propertyId) ?? properties[0] ?? null;
  return { properties, property };
}

const publicProperty = (p: SearchProperty) => ({
  id: p.id,
  siteUrl: p.siteUrl,
  status: p.status,
  syncedThrough: p.syncedThrough ? toIso(p.syncedThrough) : null,
  opportunitiesAt: p.opportunitiesAt,
  opportunitiesError: p.opportunitiesError,
});

async function keywordLimit(businessId: string) {
  const [limits, used] = await Promise.all([getEffectiveLimits(businessId), db.trackedKeyword.count({ where: { businessId } })]);
  return { used, limit: limits.trackedKeywordLimit };
}

export async function keywordsData(businessId: string, opts: { propertyId?: string | null; now?: Date } = {}) {
  const { properties, property } = await pickProperty(businessId, opts.propertyId);
  const limit = await keywordLimit(businessId);
  const base = { properties: properties.map(publicProperty), propertyId: property?.id ?? null, limit, to: null as string | null, keywords: [] as unknown[], suggestions: [] as unknown[] };
  if (!property) return base;

  const to = property.syncedThrough ? toIso(property.syncedThrough) : lastFinalDay(opts.now);
  const keywords = await db.trackedKeyword.findMany({ where: { propertyId: property.id }, orderBy: { createdAt: "asc" } });
  const historyFrom = addDaysIso(to, -(Math.max(HISTORY_DAYS, WINDOW_DAYS * 2) - 1));
  const rows = keywords.length
    ? await db.searchMetricDaily.findMany({
        where: { propertyId: property.id, kind: QUERY_KIND, key: { in: keywords.map((k) => k.keyword) }, date: { gte: fromIso(historyFrom), lte: fromIso(to) } },
        select: { date: true, key: true, clicks: true, impressions: true, position: true },
      })
    : [];
  const byKey = new Map<string, KeywordRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.key) ?? [];
    list.push({ ...r, date: toIso(r.date) });
    byKey.set(r.key, list);
  }

  // Top queries of the last 28 days that aren't tracked yet, to add in one click.
  const tracked = new Set(keywords.map((k) => k.keyword));
  const from = addDaysIso(to, -(WINDOW_DAYS - 1));
  const recent = await db.searchMetricDaily.findMany({
    where: { propertyId: property.id, kind: QUERY_KIND, date: { gte: fromIso(from), lte: fromIso(to) } },
    select: { key: true, clicks: true, impressions: true, position: true },
  });
  const suggestions = aggregateByKey(recent)
    .filter((q) => !tracked.has(q.key))
    .slice(0, 15)
    .map((q) => ({ keyword: q.key, clicks: q.clicks, impressions: q.impressions, position: round1(q.position) }));

  return {
    ...base,
    to,
    keywords: keywords.map((k) => ({ ...publicKeyword(k), ...keywordStats(byKey.get(k.keyword) ?? [], to) })),
    suggestions,
  };
}

const publicKeyword = (k: TrackedKeyword) => ({ id: k.id, keyword: k.keyword, targetUrl: k.targetUrl, rankingPage: k.rankingPage, rankingAt: k.rankingAt, createdAt: k.createdAt });

// ─── Writing ─────────────────────────────────────────────────────────

const urlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((u) => /^https?:\/\//i.test(u) && URL.canParse(u), "Enter the full page address, starting with https://");

export const addKeywordsSchema = z.object({
  propertyId: z.string().min(1).optional(),
  keywords: z.union([z.string().max(20_000), z.array(z.string().max(400)).max(500)]),
  targetUrl: urlSchema.optional().or(z.literal("")),
});

export async function addKeywords(actor: SeoActor, input: z.infer<typeof addKeywordsSchema>) {
  requireAdmin(actor);
  const { property } = await pickProperty(actor.businessId, input.propertyId);
  if (!property || (input.propertyId && property.id !== input.propertyId)) throw new AppError("Add a Search Console property first.", { status: 400, code: "NO_PROPERTY" });
  const { keywords, invalid } = parseKeywordList(input.keywords);
  if (!keywords.length) throw new AppError(invalid.length ? "Keywords can be up to 200 characters." : "Enter at least one keyword.", { status: 400, code: "INVALID_KEYWORD" });
  const existing = new Set((await db.trackedKeyword.findMany({ where: { propertyId: property.id, keyword: { in: keywords } }, select: { keyword: true } })).map((k) => k.keyword));
  const fresh = keywords.filter((k) => !existing.has(k));
  const { used, limit } = await keywordLimit(actor.businessId);
  if (limit > 0 && used + fresh.length > limit) {
    const left = Math.max(0, limit - used);
    throw new AppError(
      left ? `Your plan tracks up to ${limit} keywords. You can add ${left} more.` : `Your plan tracks up to ${limit} keywords. Remove some first.`,
      { status: 403, code: "LIMIT_REACHED" }
    );
  }
  if (fresh.length) {
    await db.trackedKeyword.createMany({
      data: fresh.map((keyword) => ({ businessId: actor.businessId, propertyId: property.id, keyword, targetUrl: input.targetUrl || null })),
      skipDuplicates: true,
    });
    await log(actor, "create", `Tracked ${fresh.length === 1 ? `the keyword "${fresh[0]}"` : `${fresh.length} keywords`}`, { keywords: fresh.slice(0, 20) });
  }
  return { added: fresh.length, skipped: keywords.length - fresh.length, invalid };
}

export const updateKeywordSchema = z.object({ targetUrl: urlSchema.nullable().or(z.literal("")) });

async function loadKeyword(businessId: string, id: string) {
  const k = await db.trackedKeyword.findFirst({ where: { id, businessId } });
  if (!k) throw new AppError("Keyword not found", { status: 404, code: "NOT_FOUND" });
  return k;
}

export async function updateKeyword(actor: SeoActor, id: string, input: z.infer<typeof updateKeywordSchema>) {
  requireAdmin(actor);
  const k = await loadKeyword(actor.businessId, id);
  const updated = await db.trackedKeyword.update({ where: { id: k.id }, data: { targetUrl: input.targetUrl || null } });
  return publicKeyword(updated);
}

export async function removeKeyword(actor: SeoActor, id: string) {
  requireAdmin(actor);
  const k = await loadKeyword(actor.businessId, id);
  await db.trackedKeyword.delete({ where: { id: k.id } });
  await log(actor, "delete", `Stopped tracking the keyword "${k.keyword}"`);
}

// ─── Opportunities ───────────────────────────────────────────────────

export const publicOpportunity = (o: SeoOpportunity) => ({
  id: o.id,
  kind: o.kind as OpportunityKind,
  query: o.query,
  page: o.page,
  pages: (o.pages as PageShare[] | null) ?? null,
  clicks: o.clicks,
  impressions: o.impressions,
  ctr: o.ctr,
  position: o.position,
  expectedCtr: o.expectedCtr,
  potentialClicks: o.potentialClicks,
  suggestion: o.suggestion,
  suggestedAt: o.suggestedAt,
  dismissed: !!o.dismissedAt,
  computedAt: o.computedAt,
});

export async function opportunitiesData(businessId: string, opts: { propertyId?: string | null; dismissed?: boolean } = {}) {
  const { properties, property } = await pickProperty(businessId, opts.propertyId);
  if (!property) return { properties: [], propertyId: null, computedAt: null, error: null, counts: null, opportunities: [] };
  const rows = await db.seoOpportunity.findMany({
    where: { propertyId: property.id, ...(opts.dismissed ? {} : { dismissedAt: null }) },
    orderBy: [{ potentialClicks: "desc" }, { impressions: "desc" }],
  });
  const all = await db.seoOpportunity.groupBy({ by: ["kind"], where: { propertyId: property.id, dismissedAt: null }, _count: { _all: true } });
  const counts = Object.fromEntries(OPPORTUNITY_KINDS.map((k) => [k, all.find((a) => a.kind === k)?._count._all ?? 0])) as Record<OpportunityKind, number>;
  const dismissedCount = await db.seoOpportunity.count({ where: { propertyId: property.id, dismissedAt: { not: null } } });
  return {
    properties: properties.map(publicProperty),
    propertyId: property.id,
    computedAt: property.opportunitiesAt,
    error: property.opportunitiesError,
    hasData: !!property.syncedThrough,
    counts,
    dismissedCount,
    opportunities: rows.map(publicOpportunity),
  };
}

async function loadOpportunity(businessId: string, id: string) {
  const o = await db.seoOpportunity.findFirst({ where: { id, businessId } });
  if (!o) throw new AppError("Opportunity not found", { status: 404, code: "NOT_FOUND" });
  return o;
}

export async function setDismissed(actor: SeoActor, id: string, dismissed: boolean) {
  requireAdmin(actor);
  const o = await loadOpportunity(actor.businessId, id);
  const updated = await db.seoOpportunity.update({ where: { id: o.id }, data: { dismissedAt: dismissed ? new Date() : null } });
  return publicOpportunity(updated);
}

/** The instruction for a low-CTR page: titles and descriptions that earn the click for this query. Pure. */
export function lowCtrTask(o: Pick<SeoOpportunity, "query" | "position" | "ctr">, facts: { title: string | null; metaDescription: string | null }): string {
  const exp = expectedCtr(o.position);
  return `This page shows in Google at an average position of ${o.position.toFixed(1)} for the search "${o.query}", but only ${(o.ctr * 100).toFixed(1)}% of searchers click (pages at that position usually get about ${Math.round(exp * 100)}%). Write 3 alternative page titles (50-60 characters, the search's main words near the start) and 2 meta descriptions (120-155 characters, saying what the searcher gets and why to click). Match what someone searching "${o.query}" wants, and only promise what the page delivers. Current title: ${JSON.stringify(facts.title ?? "")}. Current description: ${JSON.stringify(facts.metaDescription ?? "")}.`;
}

export async function suggestForOpportunity(actor: SeoActor, id: string, opts: Parameters<typeof pageSuggestions>[3] = {}) {
  requireAdmin(actor);
  const o = await loadOpportunity(actor.businessId, id);
  if (o.kind !== "low_ctr" || !o.page) throw new AppError("Title suggestions are for low click-through opportunities.", { status: 400, code: "INVALID_REQUEST" });
  const text = await pageSuggestions(actor.businessId, o.page, (facts) => lowCtrTask(o, facts), { ...opts, feature: OPPORTUNITY_SUGGEST_FEATURE });
  const updated = await db.seoOpportunity.update({ where: { id: o.id }, data: { suggestion: text, suggestedAt: new Date() } });
  return publicOpportunity(updated);
}
