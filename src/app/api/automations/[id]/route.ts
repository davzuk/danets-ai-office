import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.string().optional(),
  triggerConfig: z.record(z.any()).optional().nullable(),
  actionType: z.string().optional(),
  actionConfig: z.record(z.any()).optional().nullable(),
  isActive: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/automations/[id]
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const workflow = await db.automationWorkflow.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: any = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) data.description = parsed.data.description || null;
  if (parsed.data.triggerType) data.triggerType = parsed.data.triggerType;
  if (parsed.data.triggerConfig !== undefined) data.triggerConfig = parsed.data.triggerConfig ? JSON.stringify(parsed.data.triggerConfig) : null;
  if (parsed.data.actionType) data.actionType = parsed.data.actionType;
  if (parsed.data.actionConfig !== undefined) data.actionConfig = parsed.data.actionConfig ? JSON.stringify(parsed.data.actionConfig) : null;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const updated = await db.automationWorkflow.update({ where: { id }, data });
  return NextResponse.json({ workflow: updated });
}

// DELETE /api/automations/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const workflow = await db.automationWorkflow.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.automationWorkflow.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
