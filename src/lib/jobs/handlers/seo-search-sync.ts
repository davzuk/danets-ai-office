import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { pruneSearchMetrics, syncWindow, toIso, windowsFor } from "@/lib/seo/search";
import { defineJob } from "../define";
import { enqueue } from "../queue";

/**
 * Fetch and store one calendar-month (or shorter) window of one property's
 * Search Console data. The driver job queues these one window at a time so
 * the 16-month backfill never runs as one long job.
 */
export const seoSearchSyncWindowJob = defineJob({
  type: "seo.search-sync-window",
  schema: z.object({ propertyId: z.string(), from: z.string(), to: z.string() }),
  maxAttempts: 4,
  timeoutMs: 15 * 60_000,
  async handler({ propertyId, from, to }) {
    await syncWindow(propertyId, from, to);
  },
});

/**
 * Daily: enqueue every property's missing windows — the 16-month backfill
 * when first connected, then the daily gap through the last final day — and
 * prune expired metric rows. Dedupe keys make re-running idempotent.
 */
export const seoSearchSyncJob = defineJob({
  type: "seo.search-sync",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const properties = await db.searchProperty.findMany({ where: { status: { in: ["active", "error"] } } });
    let queued = 0;
    let skipped = 0;
    for (const p of properties) {
      if (!(await isModuleEnabled(p.businessId, "seo"))) {
        skipped++;
        continue;
      }
      const windows = windowsFor(p.syncedThrough ? toIso(p.syncedThrough) : null);
      for (const w of windows) {
        await enqueue(seoSearchSyncWindowJob, { propertyId: p.id, ...w }, { businessId: p.businessId, dedupeKey: `seo-sync:${p.id}:${w.from}:${w.to}` });
        queued++;
      }
    }
    await pruneSearchMetrics();
    logger.info("Search performance sync queued", { properties: properties.length, queued, skipped });
  },
});