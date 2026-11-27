import { z } from "zod";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { abandonAudit, dueForMonthlyAudit, failStaleAudits, runAuditChunk, startAudit } from "@/lib/seo/audit";
import { defineJob } from "../define";
import { enqueue } from "../queue";

const MAX_ATTEMPTS = 3;

/**
 * One slice of a site audit. Works for a few minutes, checkpoints, then
 * queues the next slice; a worker killed mid-slice is retried from the last
 * checkpoint. The dedupe key includes the run number so each slice is
 * queued once.
 */
export const seoAuditJob = defineJob({
  type: "seo.audit",
  schema: z.object({ auditId: z.string(), run: z.number().int().min(0).default(0) }),
  maxAttempts: MAX_ATTEMPTS,
  timeoutMs: 10 * 60_000,
  async handler({ auditId, run }, ctx) {
    try {
      const next = await runAuditChunk(auditId, { signal: ctx.signal });
      if (next === "continue") {
        await enqueue(seoAuditJob, { auditId, run: run + 1 }, { businessId: ctx.businessId, dedupeKey: `seo-audit:${auditId}:${run + 1}` });
      }
    } catch (e) {
      if (ctx.attempt >= MAX_ATTEMPTS) await abandonAudit(auditId, e);
      throw e;
    }
  },
});

export function enqueueAuditRun(auditId: string, businessId: string) {
  return enqueue(seoAuditJob, { auditId, run: 0 }, { businessId, dedupeKey: `seo-audit:${auditId}:0` });
}

/**
 * Daily: start the monthly re-audit for tenants whose last audit is over 30
 * days old (unless they turned it off), and fail audits that stopped
 * making progress.
 */
export const seoAuditScheduleJob = defineJob({
  type: "seo.audit-schedule",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const stale = await failStaleAudits();
    const due = await dueForMonthlyAudit();
    let started = 0;
    for (const businessId of due) {
      if (!(await isModuleEnabled(businessId, "seo"))) continue;
      try {
        await startAudit({ businessId, name: "Monthly audit" }, "schedule", enqueueAuditRun);
        started++;
      } catch (e) {
        logger.warn("Monthly site audit not started", { businessId, ...serializeError(e) });
      }
    }
    if (due.length || stale) logger.info("Site audit schedule", { due: due.length, started, stale });
  },
});
