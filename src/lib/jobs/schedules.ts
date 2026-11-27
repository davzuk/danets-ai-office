// Recurring jobs. Each schedule enqueues at most one job per time window:
// the dedupe key is derived from the window start, so any number of workers
// or cron ticks can call tickSchedules() without creating duplicates.

import type { z } from "zod";
import { logger, serializeError } from "@/lib/logger";
import type { JobDefinition } from "./define";
import { bookingSyncJob } from "./handlers/booking-sync";
import { connectionRefreshJob } from "./handlers/connection-refresh";
import { gbpMetricsSyncJob, gbpReviewsSyncJob } from "./handlers/gbp-sync";
import { linkedinLeadgenPollJob } from "./handlers/linkedin-leadgen";
import { metaLeadgenPollJob } from "./handlers/meta-leadgen";
import { purgeJobsJob } from "./handlers/purge-jobs";
import { seoHealthJob } from "./handlers/seo-health";
import { seoSearchSyncJob } from "./handlers/seo-search-sync";
import { seoAuditScheduleJob } from "./handlers/seo-audit";
import { socialInsightsWeeklyJob } from "./handlers/social-insights";
import { socialMetricsAccountJob } from "./handlers/social-metrics";
import { whiteLabelVerifyDomainsJob } from "./handlers/white-label-domains";
import { enqueue } from "./queue";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** The Unix epoch fell on a Thursday, so Monday is 4 days into an epoch-aligned week. */
const MONDAY = 4 * DAY;

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
  // Catches Meta leads whose webhook was dropped.
  { job: metaLeadgenPollJob, everyMs: HOUR, offsetMs: 25 * MINUTE, payload: {} },
  // LinkedIn has no lead webhook wired up yet, so it's polled.
  { job: linkedinLeadgenPollJob, everyMs: 15 * MINUTE, offsetMs: 5 * MINUTE, payload: {} },
  // Bookings whose Google Calendar event was deleted get cancelled.
  { job: bookingSyncJob, everyMs: 15 * MINUTE, offsetMs: 10 * MINUTE, payload: {} },
  // White-label custom domains waiting for their DNS TXT record.
  { job: whiteLabelVerifyDomainsJob, everyMs: 10 * MINUTE, offsetMs: 3 * MINUTE, payload: {} },
  // Follower counts, once a day.
  { job: socialMetricsAccountJob, everyMs: DAY, offsetMs: 2 * HOUR + 15 * MINUTE, payload: {} },
  // SEO: can we still read each Search Console property and Business Profile location?
  { job: seoHealthJob, everyMs: DAY, offsetMs: 4 * HOUR + 20 * MINUTE, payload: {} },
  // SEO: pull each property's Search Console search data forward and prune it.
  { job: seoSearchSyncJob, everyMs: DAY, offsetMs: 6 * HOUR + 30 * MINUTE, payload: {} },
  // SEO: monthly site re-audits, and audits that stopped making progress.
  { job: seoAuditScheduleJob, everyMs: DAY, offsetMs: 3 * HOUR + 40 * MINUTE, payload: {} },
  // Business Profile: new reviews every 2 hours, performance once a day.
  { job: gbpReviewsSyncJob, everyMs: 2 * HOUR, offsetMs: 35 * MINUTE, payload: {} },
  { job: gbpMetricsSyncJob, everyMs: DAY, offsetMs: 7 * HOUR + 10 * MINUTE, payload: {} },
  // The weekly "what worked / what next" note, Mondays 06:00 UTC.
  { job: socialInsightsWeeklyJob, everyMs: WEEK, offsetMs: MONDAY + 6 * HOUR, payload: {} },
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
