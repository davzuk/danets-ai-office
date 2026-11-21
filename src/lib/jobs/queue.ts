// Queue storage operations on the Job table.

import { Prisma, type Job } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_MAX_ATTEMPTS,
  STALE_LOCK_MS,
  describeError,
  failureOutcome,
  type JobDefinition,
} from "./define";
import type { z } from "zod";

export interface EnqueueOptions {
  businessId?: string | null;
  /** Earliest time the job may run. Defaults to now. */
  runAt?: Date;
  /** Delay in ms (ignored when runAt is given). */
  delayMs?: number;
  /** Returns the existing job instead of creating a duplicate. */
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Add a job. The payload is validated against the job's schema here, so a
 * bad payload fails at the call site instead of later in the worker.
 */
export async function enqueue<S extends z.ZodType>(
  def: JobDefinition<S>,
  payload: z.input<S>,
  opts: EnqueueOptions = {}
): Promise<Job> {
  const parsed = def.schema.parse(payload);
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  try {
    return await db.job.create({
      data: {
        type: def.type,
        payload: parsed as Prisma.InputJsonValue,
        businessId: opts.businessId ?? null,
        runAt,
        dedupeKey: opts.dedupeKey ?? null,
        maxAttempts: opts.maxAttempts ?? def.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      },
    });
  } catch (e) {
    if (
      opts.dedupeKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const existing = await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      if (existing) return existing;
    }
    throw e;
  }
}

/**
 * Atomically claim up to `limit` due jobs for `workerId`. SKIP LOCKED lets
 * concurrent workers claim disjoint sets without waiting on each other.
 */
export async function claimBatch(workerId: string, limit: number): Promise<Job[]> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM \`Job\`
      WHERE status = 'queued' AND runAt <= ${now}
      ORDER BY runAt ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx.job.updateMany({
      where: { id: { in: ids } },
      data: { status: "running", lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
    });
    return tx.job.findMany({ where: { id: { in: ids } }, orderBy: { runAt: "asc" } });
  });
}

/** Mark a claimed job done. No-op if the lock was lost (job was reaped). */
export async function completeJob(job: Pick<Job, "id">, workerId: string): Promise<boolean> {
  const res = await db.job.updateMany({
    where: { id: job.id, status: "running", lockedBy: workerId },
    data: { status: "succeeded", finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  });
  return res.count === 1;
}

/** Record a failed run: requeue with backoff, or move to `dead`. */
export async function failJob(
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  workerId: string,
  err: unknown,
  retryable: boolean
): Promise<"queued" | "dead" | "lost"> {
  const outcome = failureOutcome(job.attempts, job.maxAttempts, retryable);
  const res = await db.job.updateMany({
    where: { id: job.id, status: "running", lockedBy: workerId },
    data:
      outcome.status === "dead"
        ? { status: "dead", finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: describeError(err) }
        : { status: "queued", runAt: outcome.runAt, lockedAt: null, lockedBy: null, lastError: describeError(err) },
  });
  return res.count === 1 ? outcome.status : "lost";
}

/**
 * Return orphaned `running` jobs (worker crashed or was killed) to the
 * queue, or to `dead` if they have used up their attempts.
 */
export async function reapStaleJobs(now: Date = new Date()): Promise<{ requeued: number; dead: number }> {
  const cutoff = new Date(now.getTime() - STALE_LOCK_MS);
  const staleWhere = { status: "running", lockedAt: { lt: cutoff } } as const;
  const lastError = "Worker lock expired (worker crashed or job exceeded its lock window)";

  const dead = await db.job.updateMany({
    where: { ...staleWhere, attempts: { gte: db.job.fields.maxAttempts } },
    data: { status: "dead", finishedAt: now, lockedAt: null, lockedBy: null, lastError },
  });
  const requeued = await db.job.updateMany({
    where: staleWhere,
    data: { status: "queued", runAt: now, lockedAt: null, lockedBy: null, lastError },
  });
  return { requeued: requeued.count, dead: dead.count };
}

/** Delete finished jobs: succeeded after `succeededDays`, dead after `deadDays`. */
export async function purgeFinishedJobs(succeededDays = 14, deadDays = 30): Promise<number> {
  const day = 24 * 60 * 60_000;
  const now = Date.now();
  const res = await db.job.deleteMany({
    where: {
      OR: [
        { status: "succeeded", finishedAt: { lt: new Date(now - succeededDays * day) } },
        { status: "dead", finishedAt: { lt: new Date(now - deadDays * day) } },
      ],
    },
  });
  return res.count;
}

export interface QueueStats {
  counts: Record<"queued" | "running" | "succeeded" | "dead", number>;
  /** Due jobs waiting to run (runAt in the past). */
  due: number;
  /** Age in seconds of the oldest due job, or null. */
  oldestDueAgeSec: number | null;
}

export async function getQueueStats(): Promise<QueueStats> {
  const now = new Date();
  const [grouped, due, oldest] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.job.count({ where: { status: "queued", runAt: { lte: now } } }),
    db.job.findFirst({
      where: { status: "queued", runAt: { lte: now } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);
  const counts = { queued: 0, running: 0, succeeded: 0, dead: 0 };
  for (const g of grouped) {
    if (g.status in counts) counts[g.status as keyof typeof counts] = g._count._all;
  }
  return {
    counts,
    due,
    oldestDueAgeSec: oldest ? Math.round((now.getTime() - oldest.runAt.getTime()) / 1000) : null,
  };
}

/** Put a dead job back in the queue with a fresh set of attempts. */
export async function retryDeadJob(id: string): Promise<boolean> {
  const res = await db.job.updateMany({
    where: { id, status: "dead" },
    data: { status: "queued", runAt: new Date(), attempts: 0, finishedAt: null },
  });
  return res.count === 1;
}

/** Delete a dead job. */
export async function discardDeadJob(id: string): Promise<boolean> {
  const res = await db.job.deleteMany({ where: { id, status: "dead" } });
  return res.count === 1;
}
