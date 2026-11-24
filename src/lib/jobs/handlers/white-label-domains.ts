import { z } from "zod";
import { logger, serializeError } from "@/lib/logger";
import { runWlDomainCheck, wlDomainsDue } from "@/lib/white-label/domains";
import { defineJob } from "../define";

/**
 * Every 10 minutes: check DNS for white-label custom domains waiting to be
 * verified (for up to 72 hours), and re-check verified domains once a day.
 */
export const whiteLabelVerifyDomainsJob = defineJob({
  type: "white-label.verify-domains",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const due = await wlDomainsDue();
    let checked = 0;
    for (const { businessId } of due) {
      try {
        await runWlDomainCheck(businessId);
        checked++;
      } catch (e) {
        logger.warn("white-label domain check errored", { businessId, ...serializeError(e) });
      }
    }
    if (due.length) logger.info("white-label domains checked", { due: due.length, checked });
  },
});