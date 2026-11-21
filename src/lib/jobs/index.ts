// Background job queue. See PHASE-0-PLAN.md § B.
//
//   const myJob = defineJob({ type: "x.y", schema, handler });   // handlers/x-y.ts
//   register it in registry.ts (and schedules.ts if recurring)
//   await enqueue(myJob, payload, { businessId, dedupeKey });
//
// Jobs run in `npm run worker` (long-running) or via GET /api/cron/jobs.

export { defineJob, NonRetryableError, type JobContext, type JobDefinition } from "./define";
export { enqueue, getQueueStats, retryDeadJob, discardDeadJob, type EnqueueOptions, type QueueStats } from "./queue";
