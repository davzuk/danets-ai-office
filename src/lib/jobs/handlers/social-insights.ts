import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { INSIGHT_PERIOD_DAYS, InsightSkipped, generateInsight } from "@/lib/social/insights";
import { defineJob } from "../define";
import { enqueue } from "../queue";

/** Write one tenant's weekly insight. */
export const socialInsightsBusinessJob = defineJob({
  type: "social.insights",
  schema: z.object({ businessId: z.string(), week: z.string() }),
  maxAttempts: 3,
  timeoutMs: 3 * 60_000,
  async handler({ businessId }) {
    if (!(await isModuleEnabled(businessId, "social"))) return;
    try {
      await generateInsight(businessId, { requirePosts: true });
    } catch (e) {
      if (e instanceof InsightSkipped) {
        logger.info("Weekly content insight skipped", { businessId, reason: e.reason });
        return;
      }
      throw e;
    }
  },
});

/**
 * Mondays: queue an insight for every tenant that published through Danets in
 * the last four weeks.
 */
export const socialInsightsWeeklyJob = defineJob({
  type: "social.insights-weekly",
  schema: z.object({}),
  maxAttempts: 3,
  async handler() {
    const now = new Date();
    const since = new Date(now.getTime() - INSIGHT_PERIOD_DAYS * 24 * 60 * 60_000);
    const rows = await db.scheduledPost.groupBy({
      by: ["businessId"],
      where: { status: "published", publishedAt: { gte: since } },
    });
    const week = now.toISOString().slice(0, 10);
    for (const { businessId } of rows) {
      await enqueue(socialInsightsBusinessJob, { businessId, week }, { businessId, dedupeKey: `insights:${businessId}:${week}` });
    }
    logger.info("Weekly content insights queued", { tenants: rows.length });
  },
});
