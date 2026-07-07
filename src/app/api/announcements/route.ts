import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// GET /api/announcements — active platform announcements for logged-in tenants
export async function GET() {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const announcements = await db.platformAnnouncement.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: { startsAt: "desc" },
    take: 5,
  });

  return NextResponse.json({
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      message: a.message,
      severity: a.severity,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt?.toISOString() || null,
    })),
    businessId: user.businessId,
  });
}
