// Queue tests against a real MySQL database. They verify the parts that
// mocks can't: SKIP LOCKED claiming, lock-guarded completion, reaping.
//
// Opt-in, and destructive to the Job table of the target database:
//   JOBS_TEST_DATABASE_URL="mysql://user:pass@localhost:3306/danets_test" npm run test:db
// The target database must have migrations applied (prisma migrate deploy).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const url = process.env.JOBS_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("job queue (MySQL)", () => {
  let db: typeof import("@/lib/db").db;
  let q: typeof import("@/lib/jobs/queue");
  const def = { type: "test.noop", schema: z.object({ n: z.number() }), handler: async () => {} };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    q = await import("@/lib/jobs/queue");
  });

  beforeEach(async () => {
    await db.job.deleteMany({ where: { type: { startsWith: "test." } } });
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { type: { startsWith: "test." } } });
    await db.$disconnect();
  });

  it("never hands the same job to two concurrent workers", async () => {
    for (let i = 0; i < 40; i++) await q.enqueue(def, { n: i });

    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, w) =>
        (async () => {
          const got: string[] = [];
          for (;;) {
            const batch = await q.claimBatch(`w${w}`, 3);
            if (batch.length === 0) return got;
            got.push(...batch.map((j) => j.id));
          }
        })()
      )
    );

    const all = claims.flat();
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
  });

  it("dedupes by key", async () => {
    const a = await q.enqueue(def, { n: 1 }, { dedupeKey: "test:k" });
    const b = await q.enqueue(def, { n: 2 }, { dedupeKey: "test:k" });
    expect(b.id).toBe(a.id);
  });

  it("only the lock holder can complete a job", async () => {
    await q.enqueue(def, { n: 1 });
    const [job] = await q.claimBatch("owner", 1);
    expect(await q.completeJob(job, "intruder")).toBe(false);
    expect(await q.completeJob(job, "owner")).toBe(true);
  });

  it("requeues with backoff, then dead after maxAttempts", async () => {
    await q.enqueue(def, { n: 1 }, { maxAttempts: 2 });
    let [job] = await q.claimBatch("w", 1);
    expect(await q.failJob(job, "w", new Error("x"), true)).toBe("queued");

    await db.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
    [job] = await q.claimBatch("w", 1);
    expect(job.attempts).toBe(2);
    expect(await q.failJob(job, "w", new Error("x"), true)).toBe("dead");
  });

  it("reaps orphaned locks", async () => {
    await q.enqueue(def, { n: 1 });
    const [job] = await q.claimBatch("crashed", 1);
    await db.job.update({ where: { id: job.id }, data: { lockedAt: new Date(Date.now() - 60 * 60_000) } });

    const res = await q.reapStaleJobs();
    expect(res.requeued).toBe(1);
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("queued");
    expect(after.lockedBy).toBeNull();
  });
});
