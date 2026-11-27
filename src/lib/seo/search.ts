import "server-only";

// Search performance (Phase 3, workstream V): sync Search Console's
// searchAnalytics data into SearchMetricDaily and serve the offline
// aggregations the Performance dashboard reads. Pure date/row helpers are
// exported so unit tests can run them without MySQL or Google; the functions
// that touch the DB or the network are not.

import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { stripUrl } from "@/lib/attribution";
import { searchAnalyticsQuery, type GoogleRef, type SearchAnalyticsQuery, type SearchAnalyticsRow } from "./google";

export const SEARCH_LAG_DAYS = 3; // Search Console final data lags 2–3 days
export const BACKFILL_MONTHS = 16; // Search Console keeps 16 months of data
export const TOP_ROWS = 1000; // top queries/pages per day, by impressions
export const MAX_FETCH_ROWS = 25000; // cap per kind + window so a job can't run away

export const TOTAL_KIND = "total";
export const QUERY_KIND = "query";
export const PAGE_KIND = "page";
export const DEVICE_KIND = "device";
export const COUNTRY_KIND = "country";
const KINDS = [TOTAL_KIND, QUERY_KIND, PAGE_KIND, DEVICE_KIND, COUNTRY_KIND] as const;
export type MetricKind = (typeof KINDS)[number];

// ─── Dates (all UTC "YYYY-MM-DD") ─────────────────────────────────────

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC-midnight Date for a day string — the shape @db.Date stores. */
export function fromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Last day of the calendar month containing `iso`. */
export function endOfMonthIso(iso: string): string {
  const d = fromIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function addMonthsIso(iso: string, months: number): string {
  const d = fromIso(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, dim));
  return toIso(d);
}

/** The most recent day whose Search Console data is final. */
export function lastFinalDay(now: Date = new Date()): string {
  return addDaysIso(toIso(now), -SEARCH_LAG_DAYS);
}

export function backfillStart(lastFinal: string): string {
  return addMonthsIso(lastFinal, -BACKFILL_MONTHS);
}

export interface Window {
  from: string;
  to: string;
}

/** Split [from, to] into calendar-month windows, oldest first. */
export function monthWindows(from: string, to: string): Window[] {
  const out: Window[] = [];
  let cursor = from;
  while (cursor <= to) {
    const monthEnd = endOfMonthIso(cursor);
    const end = monthEnd < to ? monthEnd : to;
    out.push({ from: cursor, to: end });
    if (end >= to) break;
    cursor = addDaysIso(end, 1);
  }
  return out;
}

/** The windows a property still needs, given how far it has synced. */
export function windowsFor(syncedThroughIso: string | null, now: Date = new Date()): Window[] {
  const lastFinal = lastFinalDay(now);
  const from = syncedThroughIso ? addDaysIso(syncedThroughIso, 1) : backfillStart(lastFinal);
  if (from > lastFinal) return [];
  return monthWindows(from, lastFinal);
}

// ─── Row mapping (pure) ───────────────────────────────────────────────

export interface MetricRow {
  date: string;
  kind: MetricKind;
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Totals were asked with `dimensions: ["date"]`; `keys` is just [date]. */
export function toTotalRows(rows: SearchAnalyticsRow[]): MetricRow[] {
  return rows.map((r) => ({
    date: r.keys[0] ?? "",
    kind: TOTAL_KIND,
    key: "",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

/** A two-key query (`["query"|"page"|"device"|"country", "date"]`). */
export function toDimensionRows(rows: SearchAnalyticsRow[], kind: Exclude<MetricKind, "total">): MetricRow[] {
  return rows.map((r) => ({
    date: r.keys[1] ?? "",
    kind,
    key: r.keys[0] ?? "",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

/** Keep the top `n` rows of each day, by impressions (ties: clicks, then key). */
export function topPerDay(rows: MetricRow[], n: number): MetricRow[] {
  const byDay = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.date) ?? [];
    list.push(r);
    byDay.set(r.date, list);
  }
  const out: MetricRow[] = [];
  for (const list of byDay.values()) {
    list.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.key.localeCompare(b.key));
    out.push(...list.slice(0, n));
  }
  return out;
}

export interface BuildMetricsInput {
  dayRows: SearchAnalyticsRow[];
  queryRows: SearchAnalyticsRow[];
  pageRows: SearchAnalyticsRow[];
  deviceRows: SearchAnalyticsRow[];
  countryRows: SearchAnalyticsRow[];
}

/** Flatten one window's Google responses into the rows to persist. Pure. */
export function buildMetrics(input: BuildMetricsInput): MetricRow[] {
  return [
    ...toTotalRows(input.dayRows),
    ...topPerDay(toDimensionRows(input.queryRows, QUERY_KIND), TOP_ROWS),
    ...topPerDay(toDimensionRows(input.pageRows, PAGE_KIND), TOP_ROWS),
    ...toDimensionRows(input.deviceRows, DEVICE_KIND),
    ...toDimensionRows(input.countryRows, COUNTRY_KIND),
  ];
}

// ─── Aggregation (pure) ───────────────────────────────────────────────

export interface Totals {
  clicks: number;
  impressions: number;
  ctr: number; // 0–1
  position: number;
}

export const zeroTotals = (): Totals => ({ clicks: 0, impressions: 0, ctr: 0, position: 0 });

type Summable = { clicks: number; impressions: number; position: number };

/** Sum clicks/impressions and recompute CTR and the impression-weighted position. */
export function sumMetrics(rows: Summable[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weighted += r.impressions * r.position;
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? weighted / impressions : 0,
  };
}

export interface KeyAggregate extends Totals {
  key: string;
}

/** Aggregate one kind's rows by its key value (query, page, device, country). */
export function aggregateByKey(rows: { key: string; clicks: number; impressions: number; position: number }[]): KeyAggregate[] {
  const map = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  for (const r of rows) {
    const cur = map.get(r.key) ?? { clicks: 0, impressions: 0, weighted: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.weighted += r.impressions * r.position;
    map.set(r.key, cur);
  }
  return [...map.entries()]
    .map(([key, c]) => ({
      key,
      clicks: c.clicks,
      impressions: c.impressions,
      ctr: c.impressions ? c.clicks / c.impressions : 0,
      position: c.impressions ? c.weighted / c.impressions : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.key.localeCompare(b.key));
}

/** Normalise a Search Console page URL to the same shape Touchpoint.landingUrl uses. */
export function normalizePage(url: string | null | undefined): string | null {
  const stripped = stripUrl(url);
  // Search Console and the widget disagree on trailing slashes ("/services/"
  // vs "/services"), so drop it; the key is only used to join the two.
  return stripped ? stripped.toLowerCase().replace(/\/+$/, "") : null;
}

/** Distinct contacts per landing page, from (landingUrl, contactId) pairs. */
export function countLeadsByPage(rows: { landingUrl: string | null; contactId: string | null }[]): Map<string, number> {
  const contacts = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = normalizePage(r.landingUrl);
    if (!key || !r.contactId) continue;
    let set = contacts.get(key);
    if (!set) contacts.set(key, (set = new Set()));
    set.add(r.contactId);
  }
  return new Map([...contacts].map(([k, s]) => [k, s.size]));
}

// ─── Sync ─────────────────────────────────────────────────────────────

async function fetchAll(ref: GoogleRef, siteUrl: string, from: string, to: string, dimensions: SearchAnalyticsQuery["dimensions"]): Promise<SearchAnalyticsRow[]> {
  const out: SearchAnalyticsRow[] = [];
  let startRow = 0;
  while (out.length < MAX_FETCH_ROWS) {
    const rows = await searchAnalyticsQuery(ref, siteUrl, { startDate: from, endDate: to, dimensions, rowLimit: 1000, startRow, dataState: "final" });
    out.push(...rows);
    if (rows.length < 1000) break;
    startRow += rows.length;
  }
  return out;
}

export interface SyncWindowResult {
  propertyId: string;
  from: string;
  to: string;
  status: "synced" | "skipped";
  rows: number;
}

/**
 * Fetch and store one window of one property's search data. Idempotent: the
 * window's rows are deleted and re-inserted inside one transaction, so a
 * retried job re-runs cleanly instead of double-counting.
 */
export async function syncWindow(propertyId: string, from: string, to: string): Promise<SyncWindowResult> {
  const property = await db.searchProperty.findUnique({ where: { id: propertyId } });
  const skipped: SyncWindowResult = { propertyId, from, to, status: "skipped", rows: 0 };
  if (!property || property.status === "lost_access") return skipped;
  if (!(await isModuleEnabled(property.businessId, "seo"))) return skipped;

  const ref: GoogleRef = { connectionId: property.connectionId, businessId: property.businessId };
  try {
    const [dayRows, queryRows, pageRows, deviceRows, countryRows] = await Promise.all([
      fetchAll(ref, property.siteUrl, from, to, ["date"]),
      fetchAll(ref, property.siteUrl, from, to, ["query", "date"]),
      fetchAll(ref, property.siteUrl, from, to, ["page", "date"]),
      fetchAll(ref, property.siteUrl, from, to, ["device", "date"]),
      fetchAll(ref, property.siteUrl, from, to, ["country", "date"]),
    ]);
    const metrics = buildMetrics({ dayRows, queryRows, pageRows, deviceRows, countryRows });

    // Never move syncedThrough backwards when an older window is re-run.
    const advanced = !property.syncedThrough || toIso(property.syncedThrough) < to ? fromIso(to) : property.syncedThrough;

    await db.$transaction(async (tx) => {
      await tx.searchMetricDaily.deleteMany({ where: { propertyId, date: { gte: fromIso(from), lte: fromIso(to) } } });
      if (metrics.length) {
        await tx.searchMetricDaily.createMany({
          data: metrics.map((m) => ({ propertyId, date: fromIso(m.date), kind: m.kind, key: m.key.slice(0, 500), clicks: m.clicks, impressions: m.impressions, ctr: m.ctr, position: m.position })),
        });
      }
      await tx.searchProperty.update({ where: { id: propertyId }, data: { lastSyncedAt: new Date(), syncedThrough: advanced, error: null } });
    });

    logger.info("Search performance window synced", { propertyId, from, to, rows: metrics.length });
    return { propertyId, from, to, status: "synced", rows: metrics.length };
  } catch (e) {
    logger.warn("Search performance sync failed", { propertyId, from, to, ...serializeError(e) });
    throw e;
  }
}

// ─── Retention ────────────────────────────────────────────────────────

/**
 * Search Console keeps 16 months of query/page data; Danets keeps totals for
 * 5 years. Device and country rows are dimension slices like queries/pages,
 * so they follow the 16-month window. Runs daily from the search-sync job.
 */
export async function pruneSearchMetrics(now: Date = new Date()): Promise<{ queryPage: number; totals: number }> {
  const through = lastFinalDay(now);
  const dimensionsBefore = fromIso(addMonthsIso(through, -BACKFILL_MONTHS));
  const totalsBefore = fromIso(addMonthsIso(through, -60));
  const [queryPage, totals] = await Promise.all([
    db.searchMetricDaily.deleteMany({ where: { kind: { in: [QUERY_KIND, PAGE_KIND, DEVICE_KIND, COUNTRY_KIND] }, date: { lt: dimensionsBefore } } }),
    db.searchMetricDaily.deleteMany({ where: { kind: TOTAL_KIND, date: { lt: totalsBefore } } }),
  ]);
  if (queryPage.count || totals.count) logger.info("Pruned search metrics", { dimensions: queryPage.count, totals: totals.count });
  return { queryPage: queryPage.count, totals: totals.count };
}

// ─── Dashboard ────────────────────────────────────────────────────────

const RANGES = [7, 28, 90] as const;
export const PERFORMANCE_RANGES = RANGES as readonly number[];

export interface PerformanceData {
  propertyId: string | null;
  properties: { id: string; siteUrl: string; syncedThrough: string | null; lastSyncedAt: string | null }[];
  range: { from: string; to: string; days: number };
  totals: Totals;
  previous: Totals;
  series: { date: string; clicks: number; impressions: number; ctr: number; position: number }[];
  queries: (KeyAggregate & { previousClicks: number; previousImpressions: number; changeImpressions: number })[];
  pages: (KeyAggregate & { leads: number })[];
  devices: KeyAggregate[];
  countries: KeyAggregate[];
}

async function leadsByLanding(businessId: string, from: string, to: string): Promise<Map<string, number>> {
  // A lead is a contact, not a touch: anonymous visits (no contact yet) don't
  // count, and a contact who landed on the same page several times counts once.
  const groups = await db.touchpoint.groupBy({
    by: ["landingUrl", "contactId"],
    where: {
      businessId,
      channel: "organic_search",
      contactId: { not: null },
      occurredAt: { gte: fromIso(from), lt: fromIso(addDaysIso(to, 1)) },
    },
  });
  return countLeadsByPage(groups);
}

/** Aggregated data for the Performance dashboard (no live Google calls). */
export async function performanceData(businessId: string, opts: { propertyId?: string | null; rangeDays?: number; now?: Date } = {}): Promise<PerformanceData> {
  const now = opts.now ?? new Date();
  const days = RANGES.includes(opts.rangeDays as (typeof RANGES)[number]) ? (opts.rangeDays as (typeof RANGES)[number]) : 28;
  const properties = await db.searchProperty.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
  const property = properties.find((p) => p.id === opts.propertyId) ?? properties[0] ?? null;

  const to = lastFinalDay(now);
  const from = addDaysIso(to, -(days - 1));
  const range = { from, to, days };

  const base: PerformanceData = {
    propertyId: property?.id ?? null,
    properties: properties.map((p) => ({ id: p.id, siteUrl: p.siteUrl, syncedThrough: p.syncedThrough ? toIso(p.syncedThrough) : null, lastSyncedAt: p.lastSyncedAt ? p.lastSyncedAt.toISOString() : null })),
    range,
    totals: zeroTotals(),
    previous: zeroTotals(),
    series: [],
    queries: [],
    pages: [],
    devices: [],
    countries: [],
  };
  if (!property) return base;

  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(days - 1));
  const rows = await db.searchMetricDaily.findMany({
    where: { propertyId: property.id, date: { gte: fromIso(prevFrom), lte: fromIso(to) } },
    orderBy: { date: "asc" },
  });
  const norm = rows.map((r) => ({ date: toIso(r.date), kind: r.kind, key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const current = (kind: string) => norm.filter((r) => r.kind === kind && r.date >= from);
  const previous = (kind: string) => norm.filter((r) => r.kind === kind && r.date < from);

  const totals = sumMetrics(current(TOTAL_KIND));
  const previousTotals = sumMetrics(previous(TOTAL_KIND));

  // Top queries, with month-over-month movement by impressions.
  const prevQuery = new Map(aggregateByKey(previous(QUERY_KIND)).map((q) => [q.key, q]));
  const queries = aggregateByKey(current(QUERY_KIND)).slice(0, 10).map((q) => {
    const p = prevQuery.get(q.key);
    return {
      ...q,
      previousClicks: p?.clicks ?? 0,
      previousImpressions: p?.impressions ?? 0,
      changeImpressions: q.impressions - (p?.impressions ?? 0),
    };
  });

  const leads = await leadsByLanding(businessId, from, to);
  const pages = aggregateByKey(current(PAGE_KIND)).slice(0, 10).map((pg) => ({ ...pg, leads: leads.get(normalizePage(pg.key) ?? "") ?? 0 }));

  return {
    ...base,
    totals,
    previous: previousTotals,
    series: seriesFor(current(TOTAL_KIND), from, to),
    queries,
    pages,
    devices: aggregateByKey(current(DEVICE_KIND)),
    countries: aggregateByKey(current(COUNTRY_KIND)).slice(0, 10),
  };
}

/** Fill in zero days so the chart has a point for every day in the range. */
function seriesFor(rows: { date: string; clicks: number; impressions: number; position: number }[], from: string, to: string) {
  const map = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  for (const r of rows) {
    const cur = map.get(r.date) ?? { clicks: 0, impressions: 0, weighted: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.weighted += r.impressions * r.position;
    map.set(r.date, cur);
  }
  const out: { date: string; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const v = map.get(d) ?? { clicks: 0, impressions: 0, weighted: 0 };
    out.push({ date: d, clicks: v.clicks, impressions: v.impressions, ctr: v.impressions ? v.clicks / v.impressions : 0, position: v.impressions ? v.weighted / v.impressions : 0 });
  }
  return out;
}

// ─── Weekly insights context ──────────────────────────────────────────

/** One tenant's active properties, for the insights summary. */
async function primaryProperty(businessId: string) {
  return (
    (await db.searchProperty.findFirst({ where: { businessId, status: "active" }, orderBy: { createdAt: "asc" } })) ??
    (await db.searchProperty.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } }))
  );
}

/**
 * A short, numbers-only search summary the weekly AI insight (M) can quote:
 * clicks trend this period vs the previous one, and the biggest movers among
 * queries. Null when the tenant has no property or no data yet.
 */
export async function searchSummary(businessId: string, days = 28, now: Date = new Date()): Promise<string | null> {
  const property = await primaryProperty(businessId);
  if (!property) return null;

  const to = lastFinalDay(now);
  const from = addDaysIso(to, -(days - 1));
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(days - 1));

  const rows = await db.searchMetricDaily.findMany({
    where: { propertyId: property.id, kind: { in: [TOTAL_KIND, QUERY_KIND] }, date: { gte: fromIso(prevFrom), lte: fromIso(to) } },
  });
  const norm = rows.map((r) => ({ date: toIso(r.date), kind: r.kind, key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const totals = sumMetrics(norm.filter((r) => r.kind === TOTAL_KIND && r.date >= from));
  const prevTotals = sumMetrics(norm.filter((r) => r.kind === TOTAL_KIND && r.date < from));
  if (totals.impressions === 0 && prevTotals.impressions === 0) return null;

  const prevQuery = new Map(aggregateByKey(norm.filter((r) => r.kind === QUERY_KIND && r.date < from)).map((q) => [q.key, q]));
  const movers = aggregateByKey(norm.filter((r) => r.kind === QUERY_KIND && r.date >= from))
    .map((q) => ({ key: q.key, change: q.impressions - (prevQuery.get(q.key)?.impressions ?? 0) }))
    .filter((q) => q.change !== 0)
    .sort((a, b) => b.change - a.change);
  const up = movers.slice(0, 3).filter((m) => m.change > 0).map((m) => `${m.key} (+${m.change.toLocaleString()})`);
  const down = movers.slice(-3).reverse().filter((m) => m.change < 0).map((m) => `${m.key} (${m.change.toLocaleString()})`);

  const parts = [
    `Search Console (last ${days} days) for ${property.siteUrl.replace(/^sc-domain:/, "")}:`,
    totals.impressions > 0
      ? `${totals.clicks.toLocaleString()} clicks from ${totals.impressions.toLocaleString()} impressions (${Math.round(totals.ctr * 1000) / 10}% CTR, position ${totals.position.toFixed(1)}), vs ${prevTotals.clicks.toLocaleString()} clicks the prior ${days} days.`
      : "No impressions yet this period.",
  ];
  if (up.length) parts.push(`Gaining: ${up.join(", ")}.`);
  if (down.length) parts.push(`Losing: ${down.join(", ")}.`);
  return parts.join(" ");
}