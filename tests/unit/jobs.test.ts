import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  backoffMs,
  defineJob,
  describeError,
  failureOutcome,
  NonRetryableError,
  type JobDefinition,
} from "@/lib/jobs/define";
import { scheduleDedupeKey, windowStart } from "@/lib/jobs/schedules";

vi.mock("@/lib/jobs/queue", () => ({
  claimBatch: vi.fn(),
  completeJob: vi.fn(async () => true),
  failJob: vi.fn(async (_job: unknown, _w: string, _e: unknown, retryable: boolean) => (retryable ? "queued" : "dead")),
  reapStaleJobs: vi.fn(async () => ({ requeued: 0, dead: 0 })),
  enqueue: vi.fn(),
  purgeFinishedJobs: vi.fn(),
}));

const queue = await import("@/lib/jobs/queue");
const { runOnce } = await import("@/lib/jobs/runner");

describe("retry rules", () => {
  it("backs off exponentially from 30s and caps at 6h", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(30)).toBe(6 * 60 * 60_000);
  });

  it("requeues until attempts are used up, then dead", () => {
    const now = new Date("2026-11-21T00:00:00Z");
    expect(failureOutcome(1, 5, true, now)).toEqual({ status: "queued", runAt: new Date(now.getTime() + 30_000) });
    expect(failureOutcome(5, 5, true, now)).toEqual({ status: "dead" });
    expect(failureOutcome(1, 5, false, now)).toEqual({ status: "dead" });
  });

  it("truncates stored errors", () => {
    expect(describeError(new Error("boom"))).toBe("Error: boom");
    expect(describeError("x".repeat(5000))).toHaveLength(2000);
  });
});

describe("schedule windows", () => {
  it("aligns daily windows to the offset", () => {
    const day = 24 * 60 * 60_000;
    const offset = 3.5 * 60 * 60_000; // 03:30 UTC
    expect(windowStart(new Date("2026-11-21T05:00:00Z"), day, offset).toISOString()).toBe("2026-11-21T03:30:00.000Z");
    // Before 03:30 the current window is still yesterday's.
    expect(windowStart(new Date("2026-11-21T02:00:00Z"), day, offset).toISOString()).toBe("2026-11-20T03:30:00.000Z");
  });

  it("gives every tick in a window the same dedupe key", () => {
    const hour = 60 * 60_000;
    const a = windowStart(new Date("2026-11-21T10:01:00Z"), hour);
    const b = windowStart(new Date("2026-11-21T10:59:59Z"), hour);
    expect(scheduleDedupeKey("t", a)).toBe(scheduleDedupeKey("t", b));
    expect(scheduleDedupeKey("t", a)).toBe("sched:t:2026-11-21T10:00:00.000Z");
  });
});

describe("runOnce", () => {
  function job(type: string, payload: unknown, extra: Record<string, unknown> = {}) {
    return { id: `job_${type}`, type, payload, attempts: 1, maxAttempts: 5, businessId: null, ...extra } as any;
  }

  const defs = new Map<string, JobDefinition>();
  const resolve = (t: string) => defs.get(t);

  beforeEach(() => {
    vi.clearAllMocks();
    defs.clear();
  });

  function queueOnce(...jobs: unknown[]) {
    vi.mocked(queue.claimBatch).mockResolvedValueOnce(jobs as any).mockResolvedValue([]);
  }

  it("runs the handler with the parsed payload and completes the job", async () => {
    const handler = vi.fn(async () => {});
    defs.set("ok", defineJob({ type: "ok", schema: z.object({ n: z.number() }), handler }));
    queueOnce(job("ok", { n: 1 }));

    const res = await runOnce({ workerId: "w", resolve });

    expect(handler).toHaveBeenCalledWith({ n: 1 }, expect.objectContaining({ jobId: "job_ok", attempt: 1 }));
    expect(queue.completeJob).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
  });

  it("retries ordinary errors", async () => {
    defs.set("err", defineJob({ type: "err", schema: z.object({}), handler: async () => { throw new Error("flaky"); } }));
    queueOnce(job("err", {}));
    const res = await runOnce({ workerId: "w", resolve });
    expect(vi.mocked(queue.failJob).mock.calls[0][3]).toBe(true);
    expect(res.failed).toBe(1);
  });

  it("does not retry NonRetryableError, bad payloads or unknown types", async () => {
    defs.set("fatal", defineJob({ type: "fatal", schema: z.object({}), handler: async () => { throw new NonRetryableError("no"); } }));
    defs.set("typed", defineJob({ type: "typed", schema: z.object({ n: z.number() }), handler: async () => {} }));
    queueOnce(job("fatal", {}), job("typed", { n: "nope" }), job("missing", {}));

    const res = await runOnce({ workerId: "w", resolve });

    expect(vi.mocked(queue.failJob).mock.calls.map((c) => c[3])).toEqual([false, false, false]);
    expect(res).toMatchObject({ claimed: 3, dead: 3 });
  });

  it("fails a job that exceeds its timeout and aborts its signal", async () => {
    let aborted = false;
    defs.set(
      "slow",
      defineJob({
        type: "slow",
        schema: z.object({}),
        timeoutMs: 20,
        handler: (_p, ctx) =>
          new Promise<void>((resolve) => {
            ctx.signal.addEventListener("abort", () => { aborted = true; resolve(); });
          }),
      })
    );
    queueOnce(job("slow", {}));
    const res = await runOnce({ workerId: "w", resolve });
    expect(aborted).toBe(true);
    expect(String(vi.mocked(queue.failJob).mock.calls[0][2])).toMatch(/timeout/);
    expect(res.failed).toBe(1);
  });

  it("keeps claiming batches within the time budget", async () => {
    defs.set("ok", defineJob({ type: "ok", schema: z.object({}), handler: async () => {} }));
    vi.mocked(queue.claimBatch)
      .mockResolvedValueOnce([job("ok", {})])
      .mockResolvedValueOnce([job("ok", {}, { id: "second" })])
      .mockResolvedValue([]);
    const res = await runOnce({ workerId: "w", resolve, timeBudgetMs: 5_000 });
    expect(res.claimed).toBe(2);
  });
});
