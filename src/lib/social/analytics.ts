// The engagement dashboard's numbers (Phase 1 M). Pure aggregation functions
// at the top (unit tested), the DB loader at the bottom.

import { db } from "@/lib/db";
import { zonedDateKey, zonedParts } from "@/lib/content/timezone";

export const ANALYTICS_RANGES = [7, 28, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface PostMetricsView {
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  clicks: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  capturedAt: string;
}

export interface PostStat {
  id: string; // ScheduledPost id
  postId: string;
  title: string;
  excerpt: string;
  platform: string;
  accountName: string | null;
  publishedAt: string;
  permalink: string | null;
  campaignTag: string | null;
  metrics: PostMetricsView | null;
  /** engagements ÷ reach (or views when reach isn't reported); null without metrics. */
  engagementRate: number | null;
  /** Site visits through the post's tagged link. */
  visits: number;
  /** Leads whose contact arrived through the post's tagged link. */
  leads: number;
}

export interface PlatformTotals {
  platform: string;
  posts: number;
  impressions: number;
  reach: number;
  engagements: number;
  clicks: number;
  visits: number;
  leads: number;
  engagementRate: number | null;
}

export interface HeatCell {
  weekday: number; // 0 = Monday
  block: number; // 3-hour block of the day, 0 = 00:00–03:00
  posts: number;
  avgRate: number;
}

export interface FollowerSeries {
  socialAccountId: string;
  name: string;
  platform: string;
  points: { date: string; followers: number }[];
  growth: number | null;
}

export function engagementRate(m: Pick<PostMetricsView, "engagements" | "reach" | "impressions"> | null): number | null {
  if (!m || m.engagements == null) return null;
  const base = m.reach || m.impressions;
  return base ? m.engagements / base : null;
}

export function totalsByPlatform(posts: PostStat[]): PlatformTotals[] {
  const by = new Map<string, PlatformTotals & { rateBase: number; rateEng: number }>();
  for (const p of posts) {
    const t =
      by.get(p.platform) ??
      { platform: p.platform, posts: 0, impressions: 0, reach: 0, engagements: 0, clicks: 0, visits: 0, leads: 0, engagementRate: null, rateBase: 0, rateEng: 0 };
    t.posts++;
    t.impressions += p.metrics?.impressions ?? 0;
    t.reach += p.metrics?.reach ?? 0;
    t.engagements += p.metrics?.engagements ?? 0;
    t.clicks += p.metrics?.clicks ?? 0;
    t.visits += p.visits;
    t.leads += p.leads;
    const base = p.metrics ? p.metrics.reach || p.metrics.impressions : null;
    if (base && p.metrics?.engagements != null) {
      t.rateBase += base;
      t.rateEng += p.metrics.engagements;
    }
    by.set(p.platform, t);
  }
  return [...by.values()]
    .map(({ rateBase, rateEng, ...t }) => ({ ...t, engagementRate: rateBase ? rateEng / rateBase : null }))
    .sort((a, b) => b.posts - a.posts);
}

/** Per-day totals for posts published that day, in the tenant's zone, with empty days filled. */
export function dailyTrend(posts: PostStat[], tz: string, from: Date, to: Date) {
  const days = new Map<string, { date: string; posts: number; engagements: number; impressions: number; leads: number }>();
  for (let t = from.getTime(); t <= to.getTime(); t += 24 * 60 * 60_000) {
    const k = zonedDateKey(new Date(t), tz);
    days.set(k, { date: k, posts: 0, engagements: 0, impressions: 0, leads: 0 });
  }
  const last = zonedDateKey(to, tz);
  if (!days.has(last)) days.set(last, { date: last, posts: 0, engagements: 0, impressions: 0, leads: 0 });
  for (const p of posts) {
    const d = days.get(zonedDateKey(new Date(p.publishedAt), tz));
    if (!d) continue;
    d.posts++;
    d.engagements += p.metrics?.engagements ?? 0;
    d.impressions += p.metrics?.impressions ?? 0;
    d.leads += p.leads;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Average engagement rate by weekday and 3-hour block of publishing, in the tenant's zone. */
export function postingHeatmap(posts: PostStat[], tz: string): HeatCell[] {
  const cells = new Map<string, { weekday: number; block: number; posts: number; sum: number }>();
  for (const p of posts) {
    if (p.engagementRate == null) continue;
    const z = zonedParts(new Date(p.publishedAt), tz);
    const weekday = (z.weekday + 6) % 7;
    const block = Math.floor(z.hour / 3);
    const key = `${weekday}:${block}`;
    const c = cells.get(key) ?? { weekday, block, posts: 0, sum: 0 };
    c.posts++;
    c.sum += p.engagementRate;
    cells.set(key, c);
  }
  return [...cells.values()].map((c) => ({ weekday: c.weekday, block: c.block, posts: c.posts, avgRate: c.sum / c.posts }));
}

export function topPosts(posts: PostStat[], by: "engagement" | "leads", n = 5): PostStat[] {
  const score = (p: PostStat) => (by === "leads" ? p.leads : (p.engagementRate ?? -1));
  return posts
    .filter((p) => (by === "leads" ? p.leads > 0 : p.engagementRate != null))
    .sort((a, b) => score(b) - score(a) || (b.metrics?.engagements ?? 0) - (a.metrics?.engagements ?? 0))
    .slice(0, n);
}

export function followerGrowth(points: { date: string; followers: number }[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].followers - points[0].followers;
}

// ─── Loading ───────────────────────────────────────────────────────────

function excerpt(body: string, n = 160) {
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/**
 * Visits and leads per post, from touchpoints recorded through the post's
 * UTM-tagged link (utm_content = ScheduledPost id). A lead counts once per
 * post, and only if it was created after the visit.
 */
export async function attributionByPost(businessId: string, scheduledPostIds: string[]) {
  const out = new Map<string, { visits: number; leads: number }>();
  if (scheduledPostIds.length === 0) return out;
  const touches = await db.touchpoint.findMany({
    where: { businessId, content: { in: scheduledPostIds } },
    select: { content: true, contactId: true, occurredAt: true, kind: true },
  });
  const contactIds = [...new Set(touches.map((t) => t.contactId).filter((x): x is string => !!x))];
  const leads = contactIds.length
    ? await db.lead.findMany({ where: { businessId, contactId: { in: contactIds } }, select: { id: true, contactId: true, createdAt: true } })
    : [];
  const leadsByContact = new Map<string, { id: string; createdAt: Date }[]>();
  for (const l of leads) {
    if (!l.contactId) continue;
    leadsByContact.set(l.contactId, [...(leadsByContact.get(l.contactId) ?? []), l]);
  }
  const leadSets = new Map<string, Set<string>>();
  for (const t of touches) {
    const id = t.content!;
    const entry = out.get(id) ?? { visits: 0, leads: 0 };
    if (t.kind === "visit") entry.visits++;
    out.set(id, entry);
    for (const l of t.contactId ? (leadsByContact.get(t.contactId) ?? []) : []) {
      if (l.createdAt < t.occurredAt) continue;
      const set = leadSets.get(id) ?? new Set<string>();
      set.add(l.id);
      leadSets.set(id, set);
    }
  }
  for (const [id, set] of leadSets) out.get(id)!.leads = set.size;
  return out;
}

/** Published posts in [from, to] with their latest metrics snapshot and attribution. */
export async function loadPostStats(businessId: string, from: Date, to: Date): Promise<PostStat[]> {
  const rows = await db.scheduledPost.findMany({
    where: { businessId, status: "published", publishedAt: { gte: from, lte: to } },
    orderBy: { publishedAt: "desc" },
    take: 500,
    include: {
      variant: { select: { platform: true, body: true, post: { select: { id: true, title: true, brief: true, campaignTag: true } } } },
      socialAccount: { select: { name: true } },
      metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });
  const attribution = await attributionByPost(businessId, rows.map((r) => r.id));
  return rows.map((r) => {
    const m = r.metrics[0];
    const metrics: PostMetricsView | null = m
      ? {
          impressions: m.impressions,
          reach: m.reach,
          engagements: m.engagements,
          clicks: m.clicks,
          comments: m.comments,
          shares: m.shares,
          saves: m.saves,
          capturedAt: m.capturedAt.toISOString(),
        }
      : null;
    const a = attribution.get(r.id) ?? { visits: 0, leads: 0 };
    const post = r.variant.post;
    return {
      id: r.id,
      postId: post.id,
      title: post.title || excerpt(post.brief, 60),
      excerpt: excerpt(r.variant.body),
      platform: r.variant.platform,
      accountName: r.socialAccount?.name ?? null,
      publishedAt: (r.publishedAt ?? r.scheduledFor).toISOString(),
      permalink: r.permalink,
      campaignTag: post.campaignTag,
      metrics,
      engagementRate: engagementRate(metrics),
      visits: a.visits,
      leads: a.leads,
    };
  });
}

export async function loadFollowerSeries(businessId: string, from: Date, to: Date): Promise<FollowerSeries[]> {
  const [accounts, rows] = await Promise.all([
    db.socialAccount.findMany({ where: { businessId }, select: { id: true, name: true, platform: true } }),
    db.accountMetric.findMany({
      where: { businessId, date: { gte: new Date(from.toISOString().slice(0, 10)), lte: to }, followers: { not: null } },
      orderBy: { date: "asc" },
      select: { socialAccountId: true, date: true, followers: true },
    }),
  ]);
  return accounts
    .map((a) => {
      const points = rows
        .filter((r) => r.socialAccountId === a.id)
        .map((r) => ({ date: r.date.toISOString().slice(0, 10), followers: r.followers! }));
      return { socialAccountId: a.id, name: a.name, platform: a.platform, points, growth: followerGrowth(points) };
    })
    .filter((s) => s.points.length > 0);
}

export interface AnalyticsReport {
  range: { days: number; from: string; to: string; timezone: string };
  totals: PlatformTotals[];
  trend: ReturnType<typeof dailyTrend>;
  topByEngagement: PostStat[];
  topByLeads: PostStat[];
  heatmap: HeatCell[];
  followers: FollowerSeries[];
  posts: PostStat[];
}

export async function buildAnalyticsReport(businessId: string, days: number, now = new Date()): Promise<AnalyticsReport> {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
  const tz = business?.timezone || "UTC";
  const to = now;
  const from = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const [posts, followers] = await Promise.all([loadPostStats(businessId, from, to), loadFollowerSeries(businessId, from, to)]);
  return {
    range: { days, from: from.toISOString(), to: to.toISOString(), timezone: tz },
    totals: totalsByPlatform(posts),
    trend: dailyTrend(posts, tz, from, to),
    topByEngagement: topPosts(posts, "engagement"),
    topByLeads: topPosts(posts, "leads"),
    heatmap: postingHeatmap(posts, tz),
    followers,
    posts,
  };
}
