import type { Job } from "@prisma/client";
import { hostname } from "os";
import { logger, serializeError, withRequestContext } from "@/lib/logger";
import { DEFAULT_TIMEOUT_MS, NonRetryableError, type JobDefinition } from "./define";
import { claimBatch, completeJob, failJob, reapStaleJobs } from "./queue";
import { getJobDefinition } from "./registry";

export function makeWorkerId(prefix = "worker"): string {
  return `${prefix}:${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
}

export interface RunOnceOptions {
  workerId: string;
  /** Max jobs claimed and run concurrently in this pass. */
  concurrency?: number;
  /** Stop claiming new batches after this long (serverless time limits). */
  timeBudgetMs?: number;
  /** Aborts in-flight jobs (e.g. on SIGTERM). */
  signal?: AbortSignal;
  /** Override for tests. */
  resolve?: (type: string) => JobDefinition | undefined;
}

export interface RunOnceResult {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  reaped: number;
}

class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`Job exceeded its ${ms}ms timeout`);
    this.name = "JobTimeoutError";
  }
}

async function runWithTimeout(
  def: JobDefinition,
  job: Job,
  parentSignal: AbortSignal | undefined
): Promise<void> {
  const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new JobTimeoutError(timeoutMs);
      // Reject before aborting: a handler that returns promptly on abort must
      // not win the race and be recorded as a success.
      reject(err);
      controller.abort(err);
    }, timeoutMs);
  });

  try {
    const payload = def.schema.parse(job.payload);
    await Promise.race([
      def.handler(payload, {
        jobId: job.id,
        attempt: job.attempts,
        businessId: job.businessId,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

async function runJob(job: Job, opts: RunOnceOptions): Promise<"succeeded" | "queued" | "dead" | "lost"> {
  const resolve = opts.resolve ?? getJobDefinition;
  return withRequestContext(
    { requestId: `job_${job.id}`, ...(job.businessId && { businessId: job.businessId }) },
    async () => {
      const def = resolve(job.type);
      if (!def) {
        logger.error("No handler registered for job type", { jobId: job.id, type: job.type });
        return failJob(job, opts.workerId, new Error(`Unknown job type: ${job.type}`), false);
      }

      const startedAt = Date.now();
      try {
        await runWithTimeout(def, job, opts.signal);
        const kept = await completeJob(job, opts.workerId);
        logger.info("Job succeeded", { jobId: job.id, type: job.type, attempt: job.attempts, latencyMs: Date.now() - startedAt });
        return kept ? "succeeded" : "lost";
      } catch (e) {
        // A ZodError means the stored payload can never be valid: don't retry.
        const retryable = !(e instanceof NonRetryableError) && (e as Error)?.name !== "ZodError";
        const outcome = await failJob(job, opts.workerId, e, retryable);
        const log = outcome === "dead" ? logger.error : logger.warn;
        log("Job failed", {
          jobId: job.id,
          type: job.type,
          attempt: job.attempts,
          outcome,
          latencyMs: Date.now() - startedAt,
          ...serializeError(e),
        });
        return outcome;
      }
    }
  );
}

/**
 * Claim and run due jobs until the queue is empty, the time budget is spent,
 * or the signal aborts. Each pass also reaps orphaned locks.
 */
export async function runOnce(opts: RunOnceOptions): Promise<RunOnceResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const deadline = Date.now() + (opts.timeBudgetMs ?? 0);
  const result: RunOnceResult = { claimed: 0, succeeded: 0, failed: 0, dead: 0, reaped: 0 };

  const reaped = await reapStaleJobs();
  result.reaped = reaped.requeued + reaped.dead;

  do {
    if (opts.signal?.aborted) break;
    const batch = await claimBatch(opts.workerId, concurrency);
    if (batch.length === 0) break;
    result.claimed += batch.length;

    const outcomes = await Promise.all(batch.map((job) => runJob(job, opts)));
    for (const o of outcomes) {
      if (o === "succeeded") result.succeeded++;
      else if (o === "dead") result.dead++;
      else result.failed++;
    }
  } while (opts.timeBudgetMs !== undefined && Date.now() < deadline);

  return result;
}
