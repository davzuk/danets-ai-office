// Google Business Profile reviews, replies, local posts and performance
// (Phase 3, workstream X). Endpoints checked against Google's reference on
// 2026-11-27:
//   reviews.list        GET  mybusiness.googleapis.com/v4/{accounts/*/locations/*}/reviews
//   reviews.updateReply PUT  mybusiness.googleapis.com/v4/{accounts/*/locations/*/reviews/*}/reply
//   localPosts.create   POST mybusiness.googleapis.com/v4/{accounts/*/locations/*}/localPosts
//   fetchMultiDailyMetricsTimeSeries
//                       GET  businessprofileperformance.googleapis.com/v1/{locations/*}:fetchMultiDailyMetricsTimeSeries
// The mapping helpers are pure, so tests feed them recorded responses.

import { getAccessToken } from "@/lib/connections/tokens";
import { providerFetch } from "@/lib/connections/http";
import type { GoogleRef } from "./google";

const V4 = "https://mybusiness.googleapis.com/v4";
const PERFORMANCE = "https://businessprofileperformance.googleapis.com/v1";

async function send<T>(ref: GoogleRef, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getAccessToken(ref.connectionId, ref.businessId);
  return providerFetch<T>(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** The v4 parent of a location: accounts/{a}/locations/{l}. */
export function v4LocationPath(accountName: string, locationName: string): string {
  if (!/^accounts\/[\w-]+$/.test(accountName) || !/^locations\/[\w-]+$/.test(locationName)) throw new Error("Invalid location name");
  return `${accountName}/${locationName}`;
}

// ─── Reviews ─────────────────────────────────────────────────────────

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface RawReview {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string; reviewReplyState?: string };
}

export interface GbpReviewData {
  reviewName: string;
  reviewerName: string | null;
  reviewerPhoto: string | null;
  anonymous: boolean;
  starRating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  reply: { text: string; at: Date | null; state: string | null } | null;
}

/** Google appends a machine translation to some comments: "(Translated by Google) ... (Original) ...". Keep the original. */
export function originalComment(c: string | undefined | null): string | null {
  const text = c?.trim();
  if (!text) return null;
  const m = text.match(/\(Original\)\s*([\s\S]+)$/);
  return (m ? m[1].trim() : text) || null;
}

export function toReview(r: RawReview): GbpReviewData | null {
  if (!r.name || !r.createTime) return null;
  const created = new Date(r.createTime);
  if (Number.isNaN(created.getTime())) return null;
  const updated = r.updateTime ? new Date(r.updateTime) : created;
  const replyText = r.reviewReply?.comment?.trim();
  return {
    reviewName: r.name,
    reviewerName: r.reviewer?.isAnonymous ? null : r.reviewer?.displayName?.trim().slice(0, 200) || null,
    reviewerPhoto: r.reviewer?.isAnonymous ? null : r.reviewer?.profilePhotoUrl || null,
    anonymous: !!r.reviewer?.isAnonymous,
    starRating: STARS[r.starRating ?? ""] ?? 0,
    comment: originalComment(r.comment),
    createdAt: created,
    updatedAt: Number.isNaN(updated.getTime()) ? created : updated,
    reply: replyText
      ? { text: replyText, at: r.reviewReply?.updateTime ? new Date(r.reviewReply.updateTime) : null, state: r.reviewReply?.reviewReplyState ?? null }
      : null,
  };
}

export interface ReviewPage {
  reviews: GbpReviewData[];
  averageRating: number | null;
  totalReviewCount: number | null;
  nextPageToken: string | null;
}

export function toReviewPage(r: { reviews?: RawReview[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string } | null): ReviewPage {
  return {
    reviews: (r?.reviews ?? []).map(toReview).filter((x): x is GbpReviewData => !!x),
    averageRating: typeof r?.averageRating === "number" ? r.averageRating : null,
    totalReviewCount: typeof r?.totalReviewCount === "number" ? r.totalReviewCount : null,
    nextPageToken: r?.nextPageToken || null,
  };
}

/** One page of a location's reviews, most recently updated first (50 is Google's maximum). */
export async function listReviewsPage(ref: GoogleRef, locationPath: string, pageToken?: string | null): Promise<ReviewPage> {
  const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc", ...(pageToken ? { pageToken } : {}) });
  return toReviewPage(await send(ref, `${V4}/${locationPath}/reviews?${q}`));
}

/** Replies are plain text up to 4096 bytes. */
export const REPLY_MAX_BYTES = 4096;

export function replyTooLong(text: string): boolean {
  return new TextEncoder().encode(text).length > REPLY_MAX_BYTES;
}

/** Create or replace the owner's reply. Google moderates it: the state comes back PENDING, then APPROVED or REJECTED. */
export async function putReviewReply(ref: GoogleRef, reviewName: string, text: string): Promise<{ text: string; at: Date | null; state: string | null }> {
  // Review ids are opaque (encrypted) strings; only path separators are refused.
  if (!/^accounts\/[\w-]+\/locations\/[\w-]+\/reviews\/[^/?#\s]+$/.test(reviewName)) throw new Error("Invalid review name");
  const r = await send<{ comment?: string; updateTime?: string; reviewReplyState?: string }>(ref, `${V4}/${reviewName}/reply`, { method: "PUT", body: { comment: text } });
  return { text: r?.comment ?? text, at: r?.updateTime ? new Date(r.updateTime) : new Date(), state: r?.reviewReplyState ?? null };
}

// ─── Local posts ─────────────────────────────────────────────────────

export interface LocalPostInput {
  summary: string;
  languageCode: string;
  linkUrl: string | null;
  /** BOOK when the link is the tenant's booking page, otherwise LEARN_MORE. */
  actionType: "LEARN_MORE" | "BOOK";
  imageUrl: string | null;
}

export function localPostBody(i: LocalPostInput) {
  return {
    languageCode: i.languageCode,
    summary: i.summary,
    topicType: "STANDARD",
    ...(i.linkUrl ? { callToAction: { actionType: i.actionType, url: i.linkUrl } } : {}),
    ...(i.imageUrl ? { media: [{ mediaFormat: "PHOTO", sourceUrl: i.imageUrl }] } : {}),
  };
}

export async function createLocalPost(ref: GoogleRef, locationPath: string, input: LocalPostInput): Promise<{ name: string; searchUrl: string | null; state: string | null }> {
  const r = await send<{ name?: string; searchUrl?: string; state?: string }>(ref, `${V4}/${locationPath}/localPosts`, { method: "POST", body: localPostBody(input) });
  if (!r?.name) throw new Error("Google didn't return the new post.");
  return { name: r.name, searchUrl: r.searchUrl ?? null, state: r.state ?? null };
}

// ─── Performance ─────────────────────────────────────────────────────

export const GBP_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "MESSAGING_CLICKS",
] as const;
export type GbpMetric = (typeof GBP_METRICS)[number];

export interface DailyValue {
  date: string; // YYYY-MM-DD
  metric: GbpMetric;
  value: number;
}

interface RawDate {
  year?: number;
  month?: number;
  day?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Flatten the time series. Google leaves `value` out on days with nothing
 * (and sends it as an int64 string otherwise), so a missing value is 0.
 */
export function toDailyValues(r: {
  multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { date?: RawDate; value?: string | number }[] } }[] }[];
} | null): DailyValue[] {
  const out: DailyValue[] = [];
  for (const multi of r?.multiDailyMetricTimeSeries ?? []) {
    for (const series of multi.dailyMetricTimeSeries ?? []) {
      const metric = series.dailyMetric as GbpMetric;
      if (!(GBP_METRICS as readonly string[]).includes(metric)) continue;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d?.year || !d.month || !d.day) continue;
        const value = Number(dv.value ?? 0);
        out.push({ date: `${d.year}-${pad(d.month)}-${pad(d.day)}`, metric, value: Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0 });
      }
    }
  }
  return out;
}

export function performanceQuery(from: string, to: string): URLSearchParams {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const q = new URLSearchParams();
  for (const m of GBP_METRICS) q.append("dailyMetrics", m);
  q.set("dailyRange.start_date.year", String(fy));
  q.set("dailyRange.start_date.month", String(fm));
  q.set("dailyRange.start_date.day", String(fd));
  q.set("dailyRange.end_date.year", String(ty));
  q.set("dailyRange.end_date.month", String(tm));
  q.set("dailyRange.end_date.day", String(td));
  return q;
}

export async function fetchDailyMetrics(ref: GoogleRef, locationName: string, from: string, to: string): Promise<DailyValue[]> {
  if (!/^locations\/[\w-]+$/.test(locationName)) throw new Error("Invalid location name");
  return toDailyValues(await send(ref, `${PERFORMANCE}/${locationName}:fetchMultiDailyMetricsTimeSeries?${performanceQuery(from, to)}`));
}
