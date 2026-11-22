import { z } from "zod";
import { runScheduledPost } from "@/lib/social/publish/run";
import { defineJob } from "../define";
import { queuePostMetrics } from "./social-metrics";

export const PUBLISH_MAX_ATTEMPTS = 5;

/**
 * Publish one ScheduledPost at its time. Failures the user must fix (auth,
 * content) are recorded on the row and end the job; throttling and Meta-side
 * errors are rethrown so the queue retries with backoff.
 */
export const socialPublishJob = defineJob({
  type: "social.publish",
  schema: z.object({ scheduledPostId: z.string() }),
  maxAttempts: PUBLISH_MAX_ATTEMPTS,
  // Instagram can take a minute or two to process video before it can be published.
  timeoutMs: 4 * 60_000,
  async handler(p, ctx) {
    const res = await runScheduledPost(p.scheduledPostId, { attempt: ctx.attempt, maxAttempts: PUBLISH_MAX_ATTEMPTS });
    if (res.outcome === "retry" && res.error) throw res.error;
    // First engagement snapshot an hour after it went out (Phase 1 M).
    if (res.outcome === "published") await queuePostMetrics(p.scheduledPostId, 0);
  },
});
