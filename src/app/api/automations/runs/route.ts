import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// GET /api/automations/runs — list automation run history
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId") || undefined;
  const status = searchParams.get("status") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const where: any = { businessId: user.businessId };
  if (workflowId) where.workflowId = workflowId;
  if (status) where.status = status;

  const runs = await db.automationRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      workflow: {
        select: { id: true, name: true, triggerType: true, actionType: true },
      },
    },
  });

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      workflowId: r.workflowId,
      workflowName: r.workflow?.name || "Deleted workflow",
      triggerType: r.workflow?.triggerType || "unknown",
      actionType: r.workflow?.actionType || "unknown",
      status: r.status,
      error: r.error,
      triggerData: r.triggerData,
      actionData: r.actionData,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
