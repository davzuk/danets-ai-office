import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-secret";
import { makeWorkerId, runOnce } from "@/lib/jobs/runner";
import { tickSchedules } from "@/lib/jobs/schedules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/jobs
 * Serverless fallback for the background worker: enqueues due scheduled
 * jobs, then runs queued jobs for up to ~45s. Call every minute.
 * Not needed when `npm run worker` is running, but harmless alongside it.
 *
 * Requires Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const auth = await verifyCronRequest(req);
  if (!auth.ok) return auth.response;

  const scheduled = await tickSchedules();
  const result = await runOnce({
    workerId: makeWorkerId("cron"),
    concurrency: 4,
    timeBudgetMs: 45_000,
  });

  return NextResponse.json({ ok: true, scheduled, ...result, ranAt: new Date().toISOString() });
}
