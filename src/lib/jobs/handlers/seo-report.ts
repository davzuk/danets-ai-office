import { z } from "zod";
import { logger } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { dueForReport, generateReport, previousMonth, REPORT_DAY } from "@/lib/seo/report";
import { defineJob } from "../define";
import { enqueue } from "../queue";

/** Build and email one tenant's monthly SEO report. */
export const seoReportBusinessJob = defineJob({
  type: "seo.report-business",
  schema: z.object({ businessId: z.string().min(1), month: z.string().regex(/^\d{4}-\d{2}$/) }),
  maxAttempts: 3,
  timeoutMs: 5 * 60_000,
  async handler({ businessId, month }) {
    if (!(await isModuleEnabled(businessId, "seo"))) return;
    const r = await generateReport(businessId, month, { trigger: "schedule", email: true });
    logger.info("SEO report created", { businessId, month, emailed: !!r.emailedAt });
  },
});

/**
 * Daily: from the 3rd of the month (once last month's Search Console data is
 * final), queue last month's report for each tenant with SEO set up that
 * doesn't have one yet. Running daily catches tenants a failed day missed.
 */
export const seoReportJob = defineJob({
  type: "seo.report",
  schema: z.object({}),
  maxAttempts: 1,
  async handler() {
    const now = new Date();
    if (now.getUTCDate() < REPORT_DAY) return;
    const month = previousMonth(now);
    const due = await dueForReport(month);
    let queued = 0;
    for (const businessId of due) {
      if (!(await isModuleEnabled(businessId, "seo"))) continue;
      await enqueue(seoReportBusinessJob, { businessId, month }, { businessId, dedupeKey: `seo-report:${businessId}:${month}` });
      queued++;
    }
    logger.info("SEO reports queued", { month, due: due.length, queued });
  },
});
