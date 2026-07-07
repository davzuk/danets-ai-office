import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  dueDate: z.string().datetime().optional().or(z.literal("")).nullable().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/leads/[id]/tasks — list tasks for a lead
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const tasks = await db.leadTask.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
    });

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate?.toISOString() || null,
        completed: t.completed,
        completedAt: t.completedAt?.toISOString() || null,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  });
}

// POST /api/leads/[id]/tasks — create a task for a lead
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = taskSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const task = await db.leadTask.create({
      data: {
        leadId: id,
        businessId: user.businessId,
        title: parsed.data.title.trim(),
        description: parsed.data.description?.trim() || null,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        assigneeId: user.userId,
      },
    });

    // Log activity
    await db.leadActivity.create({
      data: {
        leadId: id,
        businessId: user.businessId,
        type: "task_created",
        description: `Task "${parsed.data.title.trim()}" created by ${user.name}`,
        actorId: user.userId,
        actorName: user.name,
      },
    });

    return {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate?.toISOString() || null,
        completed: task.completed,
        completedAt: task.completedAt?.toISOString() || null,
        createdAt: task.createdAt.toISOString(),
      },
    };
  });
}
