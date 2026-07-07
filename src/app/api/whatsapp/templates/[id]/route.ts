import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  content: z.string().min(1).max(2000).optional(),
  isActive: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/whatsapp/templates/[id]
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await db.whatsAppTemplate.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: any = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.content) data.content = parsed.data.content;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const updated = await db.whatsAppTemplate.update({ where: { id }, data });
  return NextResponse.json({ template: updated });
}

// DELETE /api/whatsapp/templates/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await db.whatsAppTemplate.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.whatsAppTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
