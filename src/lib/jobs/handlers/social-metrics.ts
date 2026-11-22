import { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { METRIC_STEPS_MS, metricsRunAt } from "@/lib/social/metrics";
import { syncAccountMetrics, syncPostMetrics } from "@/lib/social/metrics-sync";
import { defineJob } from "../define";
import { enqueue } from "../queue";

/**
 * One metrics snapshot of a published post. Each run queues the next one
 * (1h, 24h, 72h, 7d, then weekly to 5 weeks) until the steps run out or the
 * post can't be measured any more.
 */
export const socialMetricsPostJob = defineJob({
  type: "social.metrics-post",
  schema: z.object({ scheduledPostId: z.string(), step: z.number().int().min(0) }),
  maxAttempts: 4,
  async handler(p) {
    const outcome = await syncPostMetrics(p.scheduledPostId);
    if (outcome !== "saved") return;
    await queuePostMetrics(p.scheduledPostId, p.step + 1);
  },
});

/** Queue metrics step `step` for a post (idempotent per post and step). */
export async function queuePostMetrics(scheduledPostId: string, step = 0) {
  if (step >= METRIC_STEPS_MS.length) return;
  const row = await db.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    select: { businessId: true, publishedAt: true, status: true },
  });
  if (!row?.publishedAt || row.status !== "published") return;
  const runAt = metricsRunAt(row.publishedAt, step);
  if (!runAt) return;
  await enqueue(
    socialMetricsPostJob,
    { scheduledPostId, step },
    { businessId: row.businessId, runAt, dedupeKey: `metrics-post:${scheduledPostId}:${step}` }
  );
}

/** Daily: follower counts (and reach where reported) for every connected account. */
export const socialMetricsAccountJob = defineJob({
  type: "social.metrics-account",
  schema: z.object({ socialAccountId: z.string().optional() }),
  maxAttempts: 3,
  timeoutMs: 10 * 60_000,
  async handler({ socialAccountId }) {
    const accounts = await db.socialAccount.findMany({
      where: { status: "active", ...(socialAccountId ? { id: socialAccountId } : {}) },
    });
    let saved = 0;
    for (const acct of accounts) {
      try {
        if (await syncAccountMetrics(acct)) saved++;
      } catch (e) {
        logger.warn("Account metrics sync failed", { socialAccountId: acct.id, ...serializeError(e) });
      }
    }
    logger.info("Account metrics synced", { accounts: accounts.length, saved });
  },
});
