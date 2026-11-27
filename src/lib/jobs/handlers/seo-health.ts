import { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { checkBusiness } from "@/lib/seo/setup";
import { defineJob } from "../define";

/**
 * Daily: check that every tenant's Search Console properties and Business
 * Profile locations can still be read. Ones that can't are marked
 * lost_access (or error) and the tenant is told once.
 */
export const seoHealthJob = defineJob({
  type: "seo.health",
  schema: z.object({}),
  maxAttempts: 1,
  timeoutMs: 15 * 60_000,
  async handler() {
    const [props, locs] = await Promise.all([
      db.searchProperty.findMany({ select: { businessId: true }, distinct: ["businessId"] }),
      db.businessLocation.findMany({ select: { businessId: true }, distinct: ["businessId"] }),
    ]);
    const businesses = [...new Set([...props, ...locs].map((r) => r.businessId))];
    let checked = 0;
    for (const businessId of businesses) {
      // Tenants who lost the module keep their setup, but we stop calling Google.
      if (!(await isModuleEnabled(businessId, "seo"))) continue;
      try {
        await checkBusiness(businessId);
        checked++;
      } catch (e) {
        logger.warn("SEO health check errored", { businessId, ...serializeError(e) });
      }
    }
    if (businesses.length) logger.info("SEO health checked", { businesses: businesses.length, checked });
  },
});
