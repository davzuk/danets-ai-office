import { z } from "zod";
import { logger } from "@/lib/logger";
import { defineJob } from "../define";
import { purgeFinishedJobs } from "../queue";

/** Daily cleanup of finished jobs so the Job table stays small. */
export const purgeJobsJob = defineJob({
  type: "system.purge-jobs",
  schema: z.object({
    succeededDays: z.number().int().positive().default(14),
    deadDays: z.number().int().positive().default(30),
  }),
  maxAttempts: 3,
  async handler({ succeededDays, deadDays }) {
    const deleted = await purgeFinishedJobs(succeededDays, deadDays);
    logger.info("Purged finished jobs", { deleted, succeededDays, deadDays });
  },
});
