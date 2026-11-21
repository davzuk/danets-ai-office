import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCmsAdmin } from "@/lib/cms/server";

const updateSchema = z.object({
  altText: z.string().max(500).nullable().optional(),
  filename: z.string().min(1).max(255).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const updated = await db.cmsMedia.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ media: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;
  await db.cmsMedia.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
