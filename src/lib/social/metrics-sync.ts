// Saving metrics snapshots (Phase 1 M). The jobs in
// src/lib/jobs/handlers/social-metrics.ts call these on a schedule.

import type { SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { linkedinClient } from "@/lib/social/publish/linkedin";
import { PublishError, graphClient, type FetchLike } from "@/lib/social/publish/meta-http";
import { publishToken } from "@/lib/social/publish/run";
import {
  facebookAccountMetrics,
  facebookPostMetrics,
  instagramAccountMetrics,
  instagramPostMetrics,
  linkedinAccountMetrics,
  linkedinPostMetrics,
  type AccountMetrics,
  type PostMetrics,
} from "./metrics";

export interface SyncOptions {
  now?: Date;
  fetchImpl?: FetchLike;
}

/**
 * saved: a snapshot was stored.
 * skipped: nothing to measure now (not published by Danets, account off or disconnected).
 * gone: the platform no longer has the post; stop measuring it.
 */
export type PostSyncOutcome = "saved" | "skipped" | "gone";

async function tokenFor(acct: SocialAccount): Promise<string | null> {
  try {
    return await publishToken(acct);
  } catch (e) {
    if (e instanceof PublishError && e.kind === "auth") return null;
    throw e;
  }
}

async function fetchPostMetrics(acct: SocialAccount, token: string, externalPostId: string, opts: SyncOptions): Promise<PostMetrics> {
  if (acct.platform === "facebook_page") return facebookPostMetrics(graphClient(token, process.env, opts.fetchImpl), externalPostId);
  if (acct.platform === "instagram") return instagramPostMetrics(graphClient(token, process.env, opts.fetchImpl), externalPostId);
  if (acct.platform === "linkedin_page") return linkedinPostMetrics(linkedinClient(token, process.env, opts.fetchImpl), acct.externalId, externalPostId);
  throw new PublishError(`No metrics for ${acct.platform}.`, "content");
}

/** Take one metrics snapshot of a published post. Throws only on retryable errors. */
export async function syncPostMetrics(scheduledPostId: string, opts: SyncOptions = {}): Promise<PostSyncOutcome> {
  const row = await db.scheduledPost.findUnique({ where: { id: scheduledPostId }, include: { socialAccount: true } });
  const acct = row?.socialAccount;
  if (!row || row.status !== "published" || !row.externalPostId || !acct || acct.status !== "active") return "skipped";
  const token = await tokenFor(acct);
  if (!token) return "skipped";

  let m: PostMetrics;
  try {
    m = await fetchPostMetrics(acct, token, row.externalPostId, opts);
  } catch (e) {
    if (e instanceof PublishError && e.kind === "content") {
      logger.info("Post metrics unavailable; stopping", { scheduledPostId, error: e.message });
      return "gone";
    }
    if (e instanceof PublishError && e.kind === "auth") {
      logger.info("Post metrics not readable with this token", { scheduledPostId, error: e.message });
      return "skipped";
    }
    throw e;
  }
  const capturedAt = opts.now ?? new Date();
  await db.postMetric.create({
    data: {
      businessId: row.businessId,
      scheduledPostId: row.id,
      capturedAt,
      impressions: m.impressions,
      reach: m.reach,
      engagements: m.engagements,
      clicks: m.clicks,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      videoViews: m.videoViews,
      raw: m.raw as object,
    },
  });
  await db.scheduledPost.update({ where: { id: row.id }, data: { metricsSyncedAt: capturedAt } });
  return "saved";
}

/** UTC calendar day of `d`, as stored in AccountMetric.date. */
export function metricDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function fetchAccountMetrics(acct: SocialAccount, token: string, opts: SyncOptions): Promise<AccountMetrics | null> {
  const now = opts.now ?? new Date();
  if (acct.platform === "facebook_page") return facebookAccountMetrics(graphClient(token, process.env, opts.fetchImpl), acct.externalId, now);
  if (acct.platform === "instagram") return instagramAccountMetrics(graphClient(token, process.env, opts.fetchImpl), acct.externalId, now);
  if (acct.platform === "linkedin_page") return linkedinAccountMetrics(linkedinClient(token, process.env, opts.fetchImpl), acct.externalId);
  return null;
}

/** Record today's follower count (and reach where reported) for one account. */
export async function syncAccountMetrics(acct: SocialAccount, opts: SyncOptions = {}): Promise<boolean> {
  if (acct.status !== "active") return false;
  const token = await tokenFor(acct);
  if (!token) return false;
  let m: AccountMetrics | null;
  try {
    m = await fetchAccountMetrics(acct, token, opts);
  } catch (e) {
    if (e instanceof PublishError && e.kind !== "retry") {
      logger.info("Account metrics unavailable", { socialAccountId: acct.id, error: e.message });
      return false;
    }
    throw e;
  }
  if (!m) return false;
  const date = metricDate(opts.now ?? new Date());
  const data = { followers: m.followers, reach: m.reach, impressions: m.impressions, capturedAt: opts.now ?? new Date() };
  await db.accountMetric.upsert({
    where: { socialAccountId_date: { socialAccountId: acct.id, date } },
    create: { socialAccountId: acct.id, businessId: acct.businessId, date, ...data },
    update: data,
  });
  return true;
}
