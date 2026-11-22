import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { requireQuota } from "@/lib/plan-quota";

const TRIGGERS = [
  "new_lead", "new_ticket", "proposal_generated", "proposal_accepted",
  "lead_status_changed", "document_uploaded", "no_response_days",
  "booking_created", "booking_cancelled",
];
const ACTIONS = [
  "create_task", "send_notification", "generate_ai_followup",
  "add_lead_note", "change_lead_status", "create_ticket", "create_proposal_reminder",
  "send_booking_link",
];

// GET /api/automations — list workflows
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const active = searchParams.get("active");

    const where: any = { businessId: user.businessId };
    if (active === "true") where.isActive = true;
    if (active === "false") where.isActive = false;

    const workflows = await db.automationWorkflow.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { runs: true } },
      },
    });

    return {
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        triggerType: w.triggerType,
        triggerConfig: w.triggerConfig,
        actionType: w.actionType,
        actionConfig: w.actionConfig,
        isActive: w.isActive,
        runCount: w.runCount,
        lastRunAt: w.lastRunAt?.toISOString() || null,
        totalRuns: w._count.runs,
        createdAt: w.createdAt.toISOString(),
      })),
    };
  });
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional().or(z.literal("")),
  triggerType: z.enum(TRIGGERS as [string, ...string[]]),
  triggerConfig: z.record(z.string(), z.any()).optional(),
  actionType: z.enum(ACTIONS as [string, ...string[]]),
  actionConfig: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().default(true),
});

// POST /api/automations — create a workflow
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const d = parsed.data;
    await requireQuota(user.businessId, "automations");

    const workflow = await db.automationWorkflow.create({
      data: {
        businessId: user.businessId,
        name: d.name.trim(),
        description: d.description?.trim() || null,
        triggerType: d.triggerType,
        triggerConfig: d.triggerConfig ? JSON.stringify(d.triggerConfig) : null,
        actionType: d.actionType,
        actionConfig: d.actionConfig ? JSON.stringify(d.actionConfig) : null,
        isActive: d.isActive,
      },
    });

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "integration_changed",
      module: "integrations",
      description: `Created automation workflow "${d.name.trim()}"`,
      metadata: { workflowId: workflow.id },
    });

    return { workflow };
  });
}
