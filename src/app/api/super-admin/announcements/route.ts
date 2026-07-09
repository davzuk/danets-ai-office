import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";

const createSchema = z.object({
  title: z.string().min(2).max(120),
  message: z.string().min(2).max(2000),
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional().nullable(),
});

// GET /api/super-admin/announcements
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const announcements = await db.platformAnnouncement.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      message: a.message,
      severity: a.severity,
      isActive: a.isActive,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt?.toISOString() || null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
  });
}

// POST /api/super-admin/announcements
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const announcement = await db.platformAnnouncement.create({
    data: {
      title: parsed.data.title.trim(),
      message: parsed.data.message.trim(),
      severity: parsed.data.severity,
      isActive: parsed.data.isActive,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : new Date(),
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
    },
  });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "announcement_created",
    module: "business",
    description: `Created platform announcement: ${announcement.title}`,
    metadata: { announcementId: announcement.id },
  });

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
