import "server-only";
// Content opportunities (Phase 3, workstream Y): queries worth working on,
// found in the last 28 days of Search Console data for query and page pairs.
//
//  - almost_page_one: an average position of 8 to 20 with real impressions;
//  - low_ctr: a top-5 position with a CTR well under the norm for it, so the
//    page's title or description needs work;
//  - cannibalisation: several of the site's pages split one query.
//
// V stores queries and pages separately, so the weekly scan asks Search
// Console for the pairs once per property (one query, a few pages of rows).

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { googleJobError, searchAnalyticsQuery, type GoogleRef, type SearchAnalyticsRow } from "./google";
import { addDaysIso, lastFinalDay, sumMetrics } from "./search";

export const OPPORTUNITY_KINDS = ["almost_page_one", "low_ctr", "cannibalisation"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

/** Days of data each scan looks at. */
export const SCAN_DAYS = 28;
/** Rows asked for per call, and the most a scan reads. */
const PAGE_SIZE = 25_000;
const MAX_ROWS = 50_000;
/** Per kind, the opportunities kept (largest potential first). */
export const KEEP_PER_KIND = 25;

export const THRESHOLDS = {
  almostPageOne: { minPosition: 8, maxPosition: 20, minImpressions: 30 },
  lowCtr: { maxPosition: 5, minImpressions: 100, ratio: 0.5 },
  cannibalisation: { minImpressions: 50, minShare: 0.1, minPageImpressions: 10 },
};

/**
 * A rough benchmark of organic CTR by position, from public click-through
 * studies. Only used to rank opportunities and flag clear outliers, never
 * shown as a promise.
 */
const CTR_BY_POSITION = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export function expectedCtr(position: number): number {
  if (!(position > 0)) return 0;
  const i = Math.max(1, Math.round(position)) - 1;
  return i < CTR_BY_POSITION.length ? CTR_BY_POSITION[i] : position <= 20 ? 0.01 : 0.005;
}

export interface PairRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface PageShare {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface Opportunity {
  kind: OpportunityKind;
  query: string;
  page: string | null;
  pages: PageShare[] | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  expectedCtr: number | null;
  potentialClicks: number;
}

/** A page URL without its #fragment (Search Console can report the same page per anchor). Pure. */
export function pageKey(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Group pair rows by query, merging anchors of one page. Pure. */
export function groupByQuery(rows: PairRow[]): Map<string, PageShare[]> {
  const out = new Map<string, Map<string, { clicks: number; impressions: number; weighted: number }>>();
  for (const r of rows) {
    const q = r.query.trim();
    if (!q || r.impressions <= 0) continue;
    let pages = out.get(q);
    if (!pages) out.set(q, (pages = new Map()));
    const key = pageKey(r.page);
    const cur = pages.get(key) ?? { clicks: 0, impressions: 0, weighted: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.weighted += r.impressions * r.position;
    pages.set(key, cur);
  }
  return new Map(
    [...out].map(([q, pages]) => [
      q,
      [...pages]
        .map(([url, c]) => ({ url, clicks: c.clicks, impressions: c.impressions, position: c.impressions ? c.weighted / c.impressions : 0 }))
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.url.localeCompare(b.url)),
    ])
  );
}

/**
 * Every opportunity in one scan's pair rows, at most KEEP_PER_KIND per kind,
 * largest potential first. Pure: the fixture tests compute the same list by
 * hand. `days` scales the potential to about a month.
 */
export function findOpportunities(rows: PairRow[], days = SCAN_DAYS): Opportunity[] {
  const perMonth = 30 / days;
  const out: Opportunity[] = [];
  for (const [query, pages] of groupByQuery(rows)) {
    const t = sumMetrics(pages);
    const top = pages[0];
    const base = { query, clicks: t.clicks, impressions: t.impressions, ctr: round(t.ctr, 4), position: round(t.position) };

    const a = THRESHOLDS.almostPageOne;
    if (t.position >= a.minPosition && t.position <= a.maxPosition && t.impressions >= a.minImpressions) {
      // If it reached the middle of page one (position 5).
      const potential = Math.max(0, t.impressions * (expectedCtr(5) - t.ctr));
      out.push({ ...base, kind: "almost_page_one", page: top.url, pages: null, expectedCtr: expectedCtr(5), potentialClicks: Math.round(potential * perMonth) });
    }

    const l = THRESHOLDS.lowCtr;
    const exp = expectedCtr(t.position);
    if (t.position > 0 && t.position <= l.maxPosition && t.impressions >= l.minImpressions && t.ctr < exp * l.ratio) {
      const potential = t.impressions * (exp - t.ctr);
      out.push({ ...base, kind: "low_ctr", page: top.url, pages: null, expectedCtr: exp, potentialClicks: Math.round(potential * perMonth) });
    }

    const c = THRESHOLDS.cannibalisation;
    if (t.impressions >= c.minImpressions) {
      const split = pages.filter((p) => p.impressions >= c.minPageImpressions && p.impressions / t.impressions >= c.minShare);
      if (split.length >= 2) {
        // Clicks lost to the split: what the best page's CTR would earn on all impressions, less what it got.
        const bestCtr = Math.max(...split.map((p) => (p.impressions ? p.clicks / p.impressions : 0)));
        const potential = Math.max(0, t.impressions * bestCtr - t.clicks);
        out.push({
          ...base,
          kind: "cannibalisation",
          page: top.url,
          pages: split.map((p) => ({ ...p, position: round(p.position) })),
          expectedCtr: null,
          potentialClicks: Math.round(potential * perMonth),
        });
      }
    }
  }
  const order = (x: Opportunity, y: Opportunity) => y.potentialClicks - x.potentialClicks || y.impressions - x.impressions || x.query.localeCompare(y.query);
  return OPPORTUNITY_KINDS.flatMap((k) => out.filter((o) => o.kind === k).sort(order).slice(0, KEEP_PER_KIND));
}

/** The page each query showed most, for tracked keywords. Pure. */
export function rankingPages(rows: PairRow[]): Map<string, string> {
  return new Map([...groupByQuery(rows)].map(([q, pages]) => [q, pages[0].url]));
}

export const toPairRows = (rows: SearchAnalyticsRow[]): PairRow[] =>
  rows.map((r) => ({ query: r.keys[0] ?? "", page: r.keys[1] ?? "", clicks: r.clicks, impressions: r.impressions, position: r.position }));

// ─── Scan ────────────────────────────────────────────────────────────

export interface ScanOptions {
  now?: Date;
  /** Tests pass the rows instead of asking Google. */
  fetchRows?: (from: string, to: string) => Promise<PairRow[]>;
}

async function fetchPairs(ref: GoogleRef, siteUrl: string, from: string, to: string): Promise<PairRow[]> {
  const out: SearchAnalyticsRow[] = [];
  let startRow = 0;
  while (out.length < MAX_ROWS) {
    const rows = await searchAnalyticsQuery(ref, siteUrl, { startDate: from, endDate: to, dimensions: ["query", "page"], rowLimit: PAGE_SIZE, startRow, dataState: "final" });
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    startRow += rows.length;
  }
  return toPairRows(out);
}

/**
 * Recompute one property's opportunities. Rows still found keep their
 * dismissal and AI suggestion; the rest are replaced. Also records the page
 * each tracked keyword ranks with.
 */
export async function scanProperty(propertyId: string, opts: ScanOptions = {}): Promise<{ opportunities: number } | null> {
  const property = await db.searchProperty.findUnique({ where: { id: propertyId } });
  if (!property || property.status === "lost_access") return null;
  if (!(await isModuleEnabled(property.businessId, "seo"))) return null;
  const to = lastFinalDay(opts.now);
  const from = addDaysIso(to, -(SCAN_DAYS - 1));
  const ref: GoogleRef = { connectionId: property.connectionId, businessId: property.businessId };

  let rows: PairRow[];
  try {
    rows = opts.fetchRows ? await opts.fetchRows(from, to) : await fetchPairs(ref, property.siteUrl, from, to);
  } catch (e) {
    logger.warn("Opportunities scan failed", { propertyId, ...serializeError(e) });
    await db.searchProperty.update({ where: { id: propertyId }, data: { opportunitiesError: googleJobError(e, "opportunities scan", "this property's search data") } });
    throw e;
  }

  const found = findOpportunities(rows);
  const computedAt = opts.now ?? new Date();
  const keywords = await db.trackedKeyword.findMany({ where: { propertyId }, select: { id: true, keyword: true } });
  const ranking = rankingPages(rows);

  await db.$transaction(async (tx) => {
    const existing = await tx.seoOpportunity.findMany({ where: { propertyId }, select: { id: true, kind: true, query: true, page: true } });
    const keyOf = (o: { kind: string; query: string }) => `${o.kind}\u0000${o.query}`;
    const keep = new Map(existing.map((e) => [keyOf(e), e]));
    const seen = new Set<string>();
    for (const o of found) {
      const k = keyOf(o);
      seen.add(k);
      const data = {
        page: o.page?.slice(0, 1000) ?? null,
        pages: o.pages ? (o.pages as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        clicks: o.clicks,
        impressions: o.impressions,
        ctr: o.ctr,
        position: o.position,
        expectedCtr: o.expectedCtr,
        potentialClicks: o.potentialClicks,
        computedAt,
      };
      const prev = keep.get(k);
      if (prev) {
        // A suggestion written for another page no longer fits.
        await tx.seoOpportunity.update({ where: { id: prev.id }, data: { ...data, ...(prev.page !== data.page ? { suggestion: null, suggestedAt: null } : {}) } });
      } else {
        await tx.seoOpportunity.create({ data: { ...data, businessId: property.businessId, propertyId, kind: o.kind, query: o.query.slice(0, 500) } });
      }
    }
    const gone = existing.filter((e) => !seen.has(keyOf(e))).map((e) => e.id);
    if (gone.length) await tx.seoOpportunity.deleteMany({ where: { id: { in: gone } } });
    for (const kw of keywords) {
      await tx.trackedKeyword.update({ where: { id: kw.id }, data: { rankingPage: ranking.get(kw.keyword)?.slice(0, 1000) ?? null, rankingAt: computedAt } });
    }
    await tx.searchProperty.update({ where: { id: propertyId }, data: { opportunitiesAt: computedAt, opportunitiesError: null } });
  });
  logger.info("Opportunities scanned", { propertyId, rows: rows.length, opportunities: found.length });
  return { opportunities: found.length };
}
