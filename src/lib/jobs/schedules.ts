// Recurring jobs. Each schedule enqueues at most one job per time window:
// the dedupe key is derived from the window start, so any number of workers
// or cron ticks can call tickSchedules() without creating duplicates.

import type { z } from "zod";
import { logger, serializeError } from "@/lib/logger";
import type { JobDefinition } from "./define";
import { connectionRefreshJob } from "./handlers/connection-refresh";
import { purgeJobsJob } from "./handlers/purge-jobs";
import { enqueue } from "./queue";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface Schedule<S extends z.ZodType = z.ZodType> {
  job: JobDefinition<S>;
  /** Window length in ms; windows are aligned to the Unix epoch (UTC). */
  everyMs: number;
  /** Offset into the window before the job becomes due (e.g. run at 03:00 UTC). */
  offsetMs?: number;
  payload: z.input<S>;
}

export const SCHEDULES: Schedule[] = [
  { job: purgeJobsJob, everyMs: DAY, offsetMs: 3 * HOUR + 30 * MINUTE, payload: {} },
  { job: connectionRefreshJob, everyMs: HOUR, offsetMs: 10 * MINUTE, payload: {} },
];

/** Start of the window containing `now`, shifted by the schedule's offset. */
export function windowStart(now: Date, everyMs: number, offsetMs = 0): Date {
  const t = now.getTime() - offsetMs;
  return new Date(Math.floor(t / everyMs) * everyMs + offsetMs);
}

export function scheduleDedupeKey(type: string, start: Date): string {
  return `sched:${type}:${start.toISOString()}`;
}

/** Enqueue the current window's job for every schedule (idempotent). */
export async function tickSchedules(now: Date = new Date(), schedules: Schedule[] = SCHEDULES): Promise<number> {
  let enqueued = 0;
  for (const s of schedules) {
    const start = windowStart(now, s.everyMs, s.offsetMs);
    try {
      await enqueue(s.job, s.payload, {
        runAt: start,
        dedupeKey: scheduleDedupeKey(s.job.type, start),
      });
      enqueued++;
    } catch (e) {
      logger.error("Failed to enqueue scheduled job", { type: s.job.type, ...serializeError(e) });
    }
  }
  return enqueued;
}
