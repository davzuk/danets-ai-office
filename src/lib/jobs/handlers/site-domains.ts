import { z } from "zod";
import { logger, serializeError } from "@/lib/logger";
import { domainsDue, runDomainCheck } from "@/lib/sites/domains";
import { defineJob } from "../define";

/**
 * Every 10 minutes: check DNS for website domains waiting to be verified
 * (for up to 72 hours), and re-check verified domains once a day.
 */
export const siteVerifyDomainsJob = defineJob({
  type: "site.verify-domains",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const due = await domainsDue();
    let checked = 0;
    for (const { id } of due) {
      try {
        await runDomainCheck(id);
        checked++;
      } catch (e) {
        logger.warn("site domain check errored", { siteId: id, ...serializeError(e) });
      }
    }
    if (due.length) logger.info("site domains checked", { due: due.length, checked });
  },
});
