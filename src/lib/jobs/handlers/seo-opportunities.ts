import { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { classifyGoogleError } from "@/lib/seo/google";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import { scanProperty } from "@/lib/seo/opportunities";
import { defineJob } from "../define";
import { enqueue } from "../queue";

/** Recompute one property's content opportunities (one Search Console query). */
export const seoOpportunitiesPropertyJob = defineJob({
  type: "seo.opportunities-property",
  schema: z.object({ propertyId: z.string().min(1), slot: z.string() }),
  maxAttempts: 4,
  timeoutMs: 10 * 60_000,
  async handler({ propertyId }) {
    try {
      const r = await scanProperty(propertyId);
      if (r) logger.info("Opportunities scan done", { propertyId, ...r });
    } catch (e) {
      logger.warn("Opportunities scan failed", { propertyId, ...serializeError(e) });
      // Google 429/5xx and network errors retry with backoff; the rest are recorded on the property.
      if (!(e instanceof ConnectionUnavailableError) && classifyGoogleError(e) === "retry") throw e;
    }
  },
});

/**
 * Queue a scan now: the "Refresh" button (at most once an hour) and the first
 * scan once a property has data (at most once a day).
 */
export async function enqueueOpportunitiesScan(propertyId: string, businessId: string, kind: "refresh" | "first", now = new Date()) {
  const slot = kind === "refresh" ? `r-${Math.floor(now.getTime() / 3_600_000)}` : `f-${now.toISOString().slice(0, 10)}`;
  return enqueue(seoOpportunitiesPropertyJob, { propertyId, slot }, { businessId, dedupeKey: `seo-opps:${propertyId}:${slot}` });
}

/** Weekly (Monday morning, after the daily search sync): one scan per property with data. */
export const seoOpportunitiesJob = defineJob({
  type: "seo.opportunities",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const week = new Date().toISOString().slice(0, 10);
    const properties = await db.searchProperty.findMany({ where: { status: { not: "lost_access" }, syncedThrough: { not: null } }, select: { id: true, businessId: true } });
    let queued = 0;
    for (const p of properties) {
      if (!(await isModuleEnabled(p.businessId, "seo"))) continue;
      await enqueue(seoOpportunitiesPropertyJob, { propertyId: p.id, slot: `w-${week}` }, { businessId: p.businessId, dedupeKey: `seo-opps:${p.id}:w-${week}` });
      queued++;
    }
    logger.info("Opportunities scans queued", { properties: properties.length, queued });
  },
});
