/**
 * Long-running background job worker.
 *
 *   npm run worker
 *
 * Runs alongside the web server (systemd / pm2 / a second container). Safe
 * to run several copies: jobs are claimed with SELECT … FOR UPDATE SKIP LOCKED.
 *
 * Env:
 *   JOB_CONCURRENCY   jobs run in parallel per batch (default 4)
 *   JOB_POLL_MS       idle sleep between empty polls (default 2000)
 */
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { makeWorkerId, runOnce } from "@/lib/jobs/runner";
import { tickSchedules } from "@/lib/jobs/schedules";

const concurrency = Number(process.env.JOB_CONCURRENCY) || 4;
const pollMs = Number(process.env.JOB_POLL_MS) || 2000;
const SCHEDULE_TICK_MS = 60_000;

const workerId = makeWorkerId("worker");
const controller = new AbortController();
let stopping = false;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    controller.signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info("Worker stopping; finishing in-flight jobs", { workerId, signal });
  // Let the current batch finish; force-abort after 30s.
  setTimeout(() => controller.abort(new Error("Worker shutdown")), 30_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main() {
  logger.info("Worker started", { workerId, concurrency, pollMs });
  let lastTick = 0;

  while (!stopping) {
    try {
      if (Date.now() - lastTick >= SCHEDULE_TICK_MS) {
        await tickSchedules();
        lastTick = Date.now();
      }
      const res = await runOnce({ workerId, concurrency, signal: controller.signal });
      if (res.claimed > 0 || res.reaped > 0) logger.info("Worker pass", { workerId, ...res });
      if (res.claimed === 0) await sleep(pollMs);
    } catch (e) {
      logger.error("Worker loop error", { workerId, ...serializeError(e) });
      await sleep(pollMs * 5);
    }
  }

  await db.$disconnect();
  logger.info("Worker stopped", { workerId });
}

main().catch(async (e) => {
  logger.error("Worker crashed", { workerId, ...serializeError(e) });
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
