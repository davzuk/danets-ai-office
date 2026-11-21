// Job definitions and the pure retry/scheduling rules. No DB imports, so
// this module is safe in unit tests and in handler files.

import type { z } from "zod";

export interface JobContext {
  jobId: string;
  /** 1 on the first run, 2 on the first retry, … */
  attempt: number;
  businessId: string | null;
  /** Aborted when the job exceeds its timeout or the worker shuts down. */
  signal: AbortSignal;
}

export interface JobDefinition<S extends z.ZodType = z.ZodType> {
  /** Unique, dotted name, e.g. "connection.refresh". */
  type: string;
  schema: S;
  handler: (payload: z.infer<S>, ctx: JobContext) => Promise<void>;
  maxAttempts?: number;
  /** Per-run timeout; the handler's signal aborts when it passes. */
  timeoutMs?: number;
}

/**
 * Declare a job type. Handlers must be idempotent: a job can run more than
 * once (retry after a timeout, or a worker that died mid-run and was reaped).
 */
export function defineJob<S extends z.ZodType>(def: JobDefinition<S>): JobDefinition<S> {
  return def;
}

/** Throw from a handler to send the job straight to `dead` without retrying. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** A `running` job whose lock is older than this is assumed orphaned. */
export const STALE_LOCK_MS = 15 * 60_000;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;

/** Delay before retry number `attempts` (1-based): 30s, 60s, 2m, 4m … capped at 6h. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export type FailureOutcome =
  | { status: "queued"; runAt: Date }
  | { status: "dead" };

/** What happens to a job whose run just failed. */
export function failureOutcome(
  attempts: number,
  maxAttempts: number,
  retryable: boolean,
  now: Date = new Date()
): FailureOutcome {
  if (!retryable || attempts >= maxAttempts) return { status: "dead" };
  return { status: "queued", runAt: new Date(now.getTime() + backoffMs(attempts)) };
}

/** Trim an error into something safe to store in Job.lastError. */
export function describeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 2000);
}
