import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/notifications/[id]/read — mark a single notification as read
export function POST(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const notif = await db.notification.findFirst({
      where: {
        id,
        businessId: user.businessId,
        OR: [{ userId: null }, { userId: user.userId }],
      },
    });
    if (!notif) throw new Error("FORBIDDEN");

    await db.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return { success: true };
  });
}
