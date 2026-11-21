import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { discardDeadJob, getQueueStats, retryDeadJob } from "@/lib/jobs";

// GET /api/super-admin/jobs — queue depth and the most recent dead jobs
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const [stats, dead] = await Promise.all([
    getQueueStats(),
    db.job.findMany({
      where: { status: "dead" },
      orderBy: { finishedAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        businessId: true,
        attempts: true,
        lastError: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({ stats, dead });
}

const actionSchema = z.object({
  action: z.enum(["retry", "discard"]),
  id: z.string().min(1).max(64),
});

// POST /api/super-admin/jobs — retry or discard a dead job
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  const { action, id } = parsed.data;

  const ok = action === "retry" ? await retryDeadJob(id) : await discardDeadJob(id);
  if (!ok) return NextResponse.json({ error: "Dead job not found" }, { status: 404 });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: `job_${action}`,
    module: "platform",
    description: `${action === "retry" ? "Retried" : "Discarded"} dead background job ${id}`,
    metadata: { jobId: id },
  });

  return NextResponse.json({ ok: true });
}
