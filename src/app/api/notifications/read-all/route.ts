import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// POST /api/notifications/read-all — mark all notifications as read
export function POST(_req: NextRequest) {
  return withSession(async (user) => {
    await db.notification.updateMany({
      where: {
        businessId: user.businessId,
        OR: [{ userId: null }, { userId: user.userId }],
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { success: true };
  });
}
