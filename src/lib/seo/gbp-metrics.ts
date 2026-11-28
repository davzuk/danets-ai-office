import "server-only";
// Business Profile performance (Phase 3, workstream X): a daily sync of each
// location's impressions and actions, and the numbers the SEO Performance
// tab shows next to Search Console's.

import { db } from "@/lib/db";
import { addDaysIso, fromIso, toIso } from "./search";
import { googleJobError } from "./google";
import { fetchDailyMetrics, GBP_METRICS, type DailyValue, type GbpMetric } from "./gbp";

/** First sync reaches this far back (Google keeps about 18 months). */
export const BACKFILL_DAYS = 180;
/** Google revises recent days, so each sync re-reads this many. */
export const REFETCH_DAYS = 7;
/** Rows older than this are pruned. */
export const KEEP_DAYS = 550;

/** The window to fetch: a backfill on the first run, then from a week before the last sync up to yesterday. Pure. */
export function metricsWindow(syncedThrough: string | null, now: Date = new Date()): { from: string; to: string } | null {
  const to = addDaysIso(toIso(now), -1);
  const from = syncedThrough ? addDaysIso(syncedThrough, -REFETCH_DAYS) : addDaysIso(to, -(BACKFILL_DAYS - 1));
  return from <= to ? { from, to } : null;
}

export interface SyncMetricsOptions {
  fetch?: (from: string, to: string) => Promise<DailyValue[]>;
  now?: Date;
}

export async function syncLocationMetrics(locationId: string, opts: SyncMetricsOptions = {}): Promise<{ rows: number } | null> {
  const loc = await db.businessLocation.findUnique({ where: { id: locationId } });
  if (!loc || loc.status === "lost_access") return null;
  const window = metricsWindow(loc.metricsSyncedThrough ? toIso(loc.metricsSyncedThrough) : null, opts.now);
  if (!window) return { rows: 0 };
  const ref = { businessId: loc.businessId, connectionId: loc.connectionId };
  let values: DailyValue[];
  try {
    values = opts.fetch ? await opts.fetch(window.from, window.to) : await fetchDailyMetrics(ref, loc.locationName, window.from, window.to);
  } catch (e) {
    await db.businessLocation.update({ where: { id: loc.id }, data: { metricsError: googleJobError(e, "performance sync", "this location's performance") } });
    throw e;
  }
  const rows = values.filter((v) => v.date >= window.from && v.date <= window.to);
  await db.$transaction([
    db.gbpDailyMetric.deleteMany({ where: { locationId: loc.id, date: { gte: fromIso(window.from), lte: fromIso(window.to) } } }),
    ...(rows.length
      ? [db.gbpDailyMetric.createMany({ data: rows.map((v) => ({ businessId: loc.businessId, locationId: loc.id, date: fromIso(v.date), metric: v.metric, value: v.value })) })]
      : []),
    db.businessLocation.update({ where: { id: loc.id }, data: { metricsSyncedThrough: fromIso(window.to), metricsError: null } }),
  ]);
  return { rows: rows.length };
}

export async function pruneLocalMetrics(now: Date = new Date()): Promise<number> {
  const r = await db.gbpDailyMetric.deleteMany({ where: { date: { lt: fromIso(addDaysIso(toIso(now), -KEEP_DAYS)) } } });
  return r.count;
}

// ─── Reading ─────────────────────────────────────────────────────────

export const LOCAL_GROUPS = {
  searchViews: ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"],
  mapsViews: ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS"],
  calls: ["CALL_CLICKS"],
  websiteClicks: ["WEBSITE_CLICKS"],
  directions: ["BUSINESS_DIRECTION_REQUESTS"],
  messages: ["MESSAGING_CLICKS"],
} satisfies Record<string, GbpMetric[]>;
export type LocalGroup = keyof typeof LOCAL_GROUPS;

const GROUP_OF = new Map<string, LocalGroup>(Object.entries(LOCAL_GROUPS).flatMap(([g, ms]) => ms.map((m): [string, LocalGroup] => [m, g as LocalGroup])));

export type LocalTotals = Record<LocalGroup, number>;
const emptyTotals = (): LocalTotals => ({ searchViews: 0, mapsViews: 0, calls: 0, websiteClicks: 0, directions: 0, messages: 0 });

/** Sum metric rows into the groups shown. Pure. */
export function groupTotals(rows: { metric: string; value: number }[]): LocalTotals {
  const t = emptyTotals();
  for (const r of rows) {
    const g = GROUP_OF.get(r.metric);
    if (g) t[g] += r.value;
  }
  return t;
}

/** Views and actions per day, with every day in the range present. Pure. */
export function dailySeries(rows: { date: string; metric: string; value: number }[], from: string, to: string) {
  const byDay = new Map<string, { views: number; actions: number }>();
  for (let d = from; d <= to; d = addDaysIso(d, 1)) byDay.set(d, { views: 0, actions: 0 });
  for (const r of rows) {
    const day = byDay.get(r.date);
    const g = GROUP_OF.get(r.metric);
    if (!day || !g) continue;
    if (g === "searchViews" || g === "mapsViews") day.views += r.value;
    else day.actions += r.value;
  }
  return [...byDay].map(([date, v]) => ({ date, ...v }));
}

export async function localData(businessId: string, opts: { rangeDays?: number; now?: Date } = {}) {
  const rangeDays = opts.rangeDays ?? 28;
  const locations = await db.businessLocation.findMany({
    where: { businessId },
    orderBy: { title: "asc" },
    select: { id: true, title: true, status: true, metricsSyncedThrough: true, metricsError: true, averageRating: true, totalReviewCount: true },
  });
  if (!locations.length) return { locations: [], rangeDays, from: null, to: null, totals: null, previous: null, series: [], byLocation: [] };
  const last = locations.map((l) => (l.metricsSyncedThrough ? toIso(l.metricsSyncedThrough) : null)).filter((x): x is string => !!x).sort().at(-1);
  const to = last ?? addDaysIso(toIso(opts.now ?? new Date()), -1);
  const from = addDaysIso(to, -(rangeDays - 1));
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(rangeDays - 1));
  const [current, previous] = await Promise.all([
    db.gbpDailyMetric.findMany({ where: { businessId, date: { gte: fromIso(from), lte: fromIso(to) } }, select: { locationId: true, date: true, metric: true, value: true } }),
    db.gbpDailyMetric.groupBy({ by: ["metric"], where: { businessId, date: { gte: fromIso(prevFrom), lte: fromIso(prevTo) } }, _sum: { value: true } }),
  ]);
  const rows = current.map((r) => ({ ...r, date: toIso(r.date) }));
  return {
    locations: locations.map((l) => ({ ...l, metricsSyncedThrough: l.metricsSyncedThrough ? toIso(l.metricsSyncedThrough) : null })),
    rangeDays,
    from,
    to,
    totals: groupTotals(rows),
    previous: groupTotals(previous.map((p) => ({ metric: p.metric, value: p._sum.value ?? 0 }))),
    series: dailySeries(rows, from, to),
    byLocation: locations.map((l) => ({ id: l.id, title: l.title, totals: groupTotals(rows.filter((r) => r.locationId === l.id)) })),
    hasData: rows.length > 0,
  };
}

export { GBP_METRICS };
