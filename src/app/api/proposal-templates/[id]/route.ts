import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  sections: z.array(z.string()).optional(),
  defaultItems: z.array(z.object({
    description: z.string(),
    quantity: z.number().min(1).default(1),
    unitPrice: z.number().min(0).default(0),
  })).optional(),
  isActive: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/proposal-templates/[id] — update (only business-specific templates)
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await db.proposalTemplate.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const data: any = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) data.description = parsed.data.description || null;
  if (parsed.data.sections) data.sections = JSON.stringify(parsed.data.sections);
  if (parsed.data.defaultItems) data.defaultItems = JSON.stringify(parsed.data.defaultItems);
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const updated = await db.proposalTemplate.update({ where: { id }, data });
  return NextResponse.json({ template: updated });
}

// DELETE /api/proposal-templates/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await db.proposalTemplate.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.proposalTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
