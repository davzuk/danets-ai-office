import { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { ensureTagCampaigns, rematchTouches } from "@/lib/campaigns/service";
import { defineJob } from "../define";

/**
 * Nightly (Phase 4 AA): turn any remaining Phase 1 campaign tags into
 * campaigns, then link the last 90 days' unmatched touches by utm_campaign,
 * so a tracking name or alias added later still counts.
 */
export const campaignsRematchJob = defineJob({
  type: "campaigns.rematch",
  schema: z.object({}),
  maxAttempts: 1,
  timeoutMs: 20 * 60_000,
  async handler() {
    const tagged = await db.contentPost.findMany({ where: { campaignId: null, campaignTag: { not: null } }, distinct: ["businessId"], select: { businessId: true } });
    const withCampaigns = await db.campaign.findMany({ where: { status: { not: "archived" } }, distinct: ["businessId"], select: { businessId: true } });
    const ids = [...new Set([...tagged, ...withCampaigns].map((r) => r.businessId))];
    let matched = 0;
    for (const businessId of ids) {
      try {
        if (!(await isModuleEnabled(businessId, "campaigns"))) continue;
        await ensureTagCampaigns(businessId);
        matched += await rematchTouches(businessId, 90);
      } catch (e) {
        logger.warn("Campaign rematch failed for a business", { businessId, ...serializeError(e) });
      }
    }
    logger.info("Campaign rematch done", { businesses: ids.length, matched });
  },
});
