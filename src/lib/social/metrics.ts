// Reading engagement numbers back from the platforms (Phase 1 M).
// Fetchers take an injected client so tests can stub the HTTP layer; they
// return null fields for anything the platform didn't report.
//
// Meta replaced "impressions" with "views" in 2025: post insights now use
// post_media_view / post_total_media_view_unique, Instagram media use views.
// Metrics a Page or media type doesn't support are skipped, not fatal.

import { orgUrn } from "@/lib/connections/providers/linkedin";
import type { LinkedInClient } from "@/lib/social/publish/linkedin";
import { PublishError, type GraphClient } from "@/lib/social/publish/meta-http";

export interface PostMetrics {
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  clicks: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  videoViews: number | null;
  raw: Record<string, unknown>;
}

export interface AccountMetrics {
  followers: number | null;
  reach: number | null;
  impressions: number | null;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * When post metrics are captured, measured from publishing: 1 hour, 24 hours,
 * 72 hours and 7 days, then weekly for 4 more weeks.
 */
export const METRIC_STEPS_MS = [HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 21 * DAY, 28 * DAY, 35 * DAY] as const;

/** When step `step` (0-based) runs for a post published at `publishedAt`, or null after the last. */
export function metricsRunAt(publishedAt: Date, step: number): Date | null {
  const offset = METRIC_STEPS_MS[step];
  return offset === undefined ? null : new Date(publishedAt.getTime() + offset);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Sum the numbers that are present; null when none are. */
export function sumPresent(...vals: (number | null | undefined)[]): number | null {
  const present = vals.filter((v): v is number => typeof v === "number");
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// ─── Meta ──────────────────────────────────────────────────────────────

interface InsightRow {
  name?: string;
  values?: { value?: unknown }[];
  total_value?: { value?: unknown };
}

/** The latest value of each metric in an insights response. Pure. */
export function readInsights(data: InsightRow[] | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const row of data ?? []) {
    if (!row.name) continue;
    const v = row.total_value?.value ?? row.values?.[row.values.length - 1]?.value;
    // Breakdown metrics come back as { type: count } objects; add them up.
    out[row.name] =
      v && typeof v === "object" ? sumPresent(...Object.values(v as Record<string, unknown>).map(num)) : num(v);
  }
  return out;
}

/**
 * An error that only means "this number isn't available": an unsupported
 * metric or field (content), or a missing insights permission (code 10 or
 * 200-299), which Meta reports for one call while the token is otherwise fine.
 */
export function skippable(e: unknown): boolean {
  if (!(e instanceof PublishError)) return false;
  // Code 100 / subcode 33: the object itself doesn't exist (post deleted). Not skippable.
  if (e.code === 100 && e.subcode === 33) return false;
  if (e.kind === "content") return true;
  return e.kind === "auth" && e.code !== undefined && (e.code === 10 || (e.code >= 200 && e.code <= 299));
}

/**
 * Ask for several insight metrics at once; if Meta rejects the set (one
 * unsupported metric fails the whole call), ask for each one alone and keep
 * what works. Auth and throttling errors are rethrown.
 */
export async function fetchInsights(
  client: GraphClient,
  path: string,
  metrics: string[],
  params: Record<string, string> = {}
): Promise<Record<string, number | null>> {
  const get = (m: string[]) => client.get<{ data?: InsightRow[] }>(path, { ...params, metric: m.join(",") });
  try {
    return readInsights((await get(metrics)).data);
  } catch (e) {
    if (!skippable(e)) throw e;
    if (metrics.length === 1) return {};
  }
  const out: Record<string, number | null> = {};
  for (const m of metrics) {
    try {
      Object.assign(out, readInsights((await get([m])).data));
    } catch (e) {
      if (!skippable(e)) throw e;
    }
  }
  return out;
}

/** Fields read, tolerating a node type that doesn't have them. */
async function fetchFields<T>(client: GraphClient, path: string, fields: string): Promise<T | null> {
  try {
    return await client.get<T>(path, { fields });
  } catch (e) {
    if (skippable(e)) return null;
    throw e;
  }
}

export const FACEBOOK_POST_METRICS = ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_video_views"];

export async function facebookPostMetrics(client: GraphClient, postId: string): Promise<PostMetrics> {
  const path = `/${encodeURIComponent(postId)}`;
  const [fields, ins] = await Promise.all([
    fetchFields<{
      shares?: { count?: number };
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
    }>(client, path, "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)"),
    fetchInsights(client, `${path}/insights`, FACEBOOK_POST_METRICS),
  ]);
  const reactions = num(fields?.reactions?.summary?.total_count);
  const comments = num(fields?.comments?.summary?.total_count);
  const shares = fields ? (num(fields.shares?.count) ?? 0) : null; // Meta omits `shares` when there are none
  return {
    impressions: ins.post_media_view ?? null,
    reach: ins.post_total_media_view_unique ?? null,
    engagements: sumPresent(reactions, comments, shares),
    clicks: ins.post_clicks ?? null,
    comments,
    shares,
    saves: null,
    videoViews: ins.post_video_views ?? null,
    raw: { reactions, ...ins },
  };
}

export const INSTAGRAM_MEDIA_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"];

export async function instagramPostMetrics(client: GraphClient, mediaId: string): Promise<PostMetrics> {
  const ins = await fetchInsights(client, `/${encodeURIComponent(mediaId)}/insights`, INSTAGRAM_MEDIA_METRICS);
  const likes = ins.likes ?? null;
  const comments = ins.comments ?? null;
  const shares = ins.shares ?? null;
  const saves = ins.saved ?? null;
  return {
    impressions: ins.views ?? null,
    reach: ins.reach ?? null,
    engagements: ins.total_interactions ?? sumPresent(likes, comments, shares, saves),
    clicks: null,
    comments,
    shares,
    saves,
    videoViews: null,
    raw: { ...ins },
  };
}

export async function facebookAccountMetrics(client: GraphClient, pageId: string, now = new Date()): Promise<AccountMetrics> {
  const path = `/${encodeURIComponent(pageId)}`;
  const [fields, ins] = await Promise.all([
    fetchFields<{ followers_count?: number; fan_count?: number }>(client, path, "followers_count,fan_count"),
    fetchInsights(client, `${path}/insights`, ["page_total_media_view_unique", "page_media_view"], {
      period: "day",
      since: String(Math.floor((now.getTime() - 2 * DAY) / 1000)),
      until: String(Math.floor(now.getTime() / 1000)),
    }),
  ]);
  return {
    followers: num(fields?.followers_count) ?? num(fields?.fan_count),
    reach: ins.page_total_media_view_unique ?? null,
    impressions: ins.page_media_view ?? null,
  };
}

export async function instagramAccountMetrics(client: GraphClient, igId: string, now = new Date()): Promise<AccountMetrics> {
  const path = `/${encodeURIComponent(igId)}`;
  const [fields, ins] = await Promise.all([
    fetchFields<{ followers_count?: number }>(client, path, "followers_count"),
    fetchInsights(client, `${path}/insights`, ["reach", "views"], {
      period: "day",
      metric_type: "total_value",
      since: String(Math.floor((now.getTime() - DAY) / 1000)),
      until: String(Math.floor(now.getTime() / 1000)),
    }),
  ]);
  return { followers: num(fields?.followers_count), reach: ins.reach ?? null, impressions: ins.views ?? null };
}

// ─── LinkedIn ──────────────────────────────────────────────────────────

interface ShareStatistics {
  impressionCount?: number;
  uniqueImpressionsCount?: number;
  clickCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  engagement?: number;
}

/** Restli-encode a URN for use inside a List(...) query value. */
const enc = (urn: string) => encodeURIComponent(urn);

export async function linkedinPostMetrics(client: LinkedInClient, organizationId: string, postUrn: string): Promise<PostMetrics> {
  const kind = postUrn.startsWith("urn:li:ugcPost:") ? "ugcPosts" : "shares";
  const { data } = await client.json<{ elements?: { totalShareStatistics?: ShareStatistics }[] }>(
    "GET",
    `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(orgUrn(organizationId))}&${kind}=List(${enc(postUrn)})`
  );
  const s = data.elements?.[0]?.totalShareStatistics ?? {};
  const likes = num(s.likeCount);
  const comments = num(s.commentCount);
  const shares = num(s.shareCount);
  return {
    impressions: num(s.impressionCount),
    reach: num(s.uniqueImpressionsCount),
    engagements: sumPresent(likes, comments, shares),
    clicks: num(s.clickCount),
    comments,
    shares,
    saves: null,
    videoViews: null,
    raw: { ...s },
  };
}

export async function linkedinAccountMetrics(client: LinkedInClient, organizationId: string): Promise<AccountMetrics> {
  const { data } = await client.json<{ firstDegreeSize?: number }>(
    "GET",
    `/networkSizes/${enc(orgUrn(organizationId))}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`
  );
  return { followers: num(data.firstDegreeSize), reach: null, impressions: null };
}
