import { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { classifyGoogleError } from "@/lib/seo/google";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import { syncLocationReviews } from "@/lib/seo/reviews";
import { pruneLocalMetrics, syncLocationMetrics } from "@/lib/seo/gbp-metrics";
import { defineJob } from "../define";
import { enqueue } from "../queue";

/** Errors the queue should retry with backoff (Google 429/5xx, network). The rest are recorded on the location. */
function rethrowIfRetryable(e: unknown) {
  if (e instanceof ConnectionUnavailableError) return;
  if (classifyGoogleError(e) === "retry") throw e;
}

const REVIEWS_EVERY_MS = 2 * 3_600_000;

export const gbpReviewsLocationJob = defineJob({
  type: "gbp.reviews-sync-location",
  schema: z.object({ locationId: z.string().min(1), slot: z.string().optional() }),
  maxAttempts: 4,
  timeoutMs: 10 * 60_000,
  async handler({ locationId }) {
    try {
      const r = await syncLocationReviews(locationId);
      logger.info("Business Profile reviews synced", { locationId, ...r });
    } catch (e) {
      logger.warn("Business Profile reviews sync failed", { locationId, ...serializeError(e) });
      rethrowIfRetryable(e);
    }
  },
});

/** Queue a reviews sync now (the "Sync now" button), at most once a minute per location. */
export async function enqueueReviewsSync(locationId: string, businessId: string, now = new Date()) {
  const slot = `now-${Math.floor(now.getTime() / 60_000)}`;
  return enqueue(gbpReviewsLocationJob, { locationId, slot }, { businessId, dedupeKey: `gbp-reviews:${locationId}:${slot}` });
}

/** Every 2 hours: one reviews sync per location of a tenant with the SEO module. */
export const gbpReviewsSyncJob = defineJob({
  type: "gbp.reviews-sync",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const slot = String(Math.floor(Date.now() / REVIEWS_EVERY_MS));
    const locations = await db.businessLocation.findMany({ where: { status: { not: "lost_access" } }, select: { id: true, businessId: true } });
    let queued = 0;
    for (const l of locations) {
      if (!(await isModuleEnabled(l.businessId, "seo"))) continue;
      await enqueue(gbpReviewsLocationJob, { locationId: l.id, slot }, { businessId: l.businessId, dedupeKey: `gbp-reviews:${l.id}:${slot}` });
      queued++;
    }
    logger.info("Business Profile reviews sync queued", { locations: locations.length, queued });
  },
});

export const gbpMetricsLocationJob = defineJob({
  type: "gbp.metrics-sync-location",
  schema: z.object({ locationId: z.string().min(1), day: z.string() }),
  maxAttempts: 4,
  timeoutMs: 10 * 60_000,
  async handler({ locationId }) {
    try {
      const r = await syncLocationMetrics(locationId);
      logger.info("Business Profile performance synced", { locationId, rows: r?.rows ?? 0 });
    } catch (e) {
      logger.warn("Business Profile performance sync failed", { locationId, ...serializeError(e) });
      rethrowIfRetryable(e);
    }
  },
});

/** Daily: one performance sync per location, and pruning of old rows. */
export const gbpMetricsSyncJob = defineJob({
  type: "gbp.metrics-sync",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const day = new Date().toISOString().slice(0, 10);
    const locations = await db.businessLocation.findMany({ where: { status: { not: "lost_access" } }, select: { id: true, businessId: true } });
    let queued = 0;
    for (const l of locations) {
      if (!(await isModuleEnabled(l.businessId, "seo"))) continue;
      await enqueue(gbpMetricsLocationJob, { locationId: l.id, day }, { businessId: l.businessId, dedupeKey: `gbp-metrics:${l.id}:${day}` });
      queued++;
    }
    const pruned = await pruneLocalMetrics();
    logger.info("Business Profile performance sync queued", { locations: locations.length, queued, pruned });
  },
});
