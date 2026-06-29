import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const toggleSchema = z.object({
  completed: z.boolean(),
});

type RouteCtx = { params: Promise<{ id: string; taskId: string }> };

// PATCH /api/leads/[id]/tasks/[taskId] — toggle task completion
export function PATCH(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id, taskId } = await params;

    // Verify lead belongs to business
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) throw new Error("Invalid input");

    const task = await db.leadTask.findFirst({
      where: { id: taskId, leadId: id },
      select: { id: true, title: true, completed: true },
    });
    if (!task) throw new Error("Task not found");

    const updated = await db.leadTask.update({
      where: { id: taskId },
      data: {
        completed: parsed.data.completed,
        completedAt: parsed.data.completed ? new Date() : null,
      },
    });

    // Log activity
    await db.leadActivity.create({
      data: {
        leadId: id,
        businessId: user.businessId,
        type: parsed.data.completed ? "task_completed" : "task_reopened",
        description: `Task "${task.title}" ${parsed.data.completed ? "completed" : "reopened"} by ${user.name}`,
        actorId: user.userId,
        actorName: user.name,
      },
    });

    return {
      task: {
        id: updated.id,
        title: updated.title,
        completed: updated.completed,
        completedAt: updated.completedAt?.toISOString() || null,
      },
    };
  });
}

// DELETE /api/leads/[id]/tasks/[taskId] — delete a task
export function DELETE(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id, taskId } = await params;

    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    await db.leadTask.deleteMany({ where: { id: taskId, leadId: id } });
    return { success: true };
  });
}
