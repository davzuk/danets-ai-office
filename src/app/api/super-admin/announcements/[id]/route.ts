import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

const patchSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  message: z.string().min(2).max(2000).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional().nullable(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/super-admin/announcements/[id]
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { id } = await params;
  const existing = await db.platformAnnouncement.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.title) data.title = parsed.data.title.trim();
  if (parsed.data.message) data.message = parsed.data.message.trim();
  if (parsed.data.severity) data.severity = parsed.data.severity;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.startsAt) data.startsAt = new Date(parsed.data.startsAt);
  if (parsed.data.endsAt !== undefined) {
    data.endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  }

  const announcement = await db.platformAnnouncement.update({ where: { id }, data });

  return NextResponse.json({
    announcement: {
      ...announcement,
      startsAt: announcement.startsAt.toISOString(),
      endsAt: announcement.endsAt?.toISOString() || null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    },
  });
}

// DELETE /api/super-admin/announcements/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { id } = await params;
  await db.platformAnnouncement.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
