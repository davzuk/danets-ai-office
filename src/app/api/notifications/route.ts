import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/notifications — returns real notification records + unread counts
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;

    // Fetch real notifications (targeted to this user OR business-wide)
    const notifications = await db.notification.findMany({
      where: {
        businessId,
        OR: [{ userId: null }, { userId: user.userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const unreadCount = notifications.filter((n) => !n.readAt).length;
    const unreadNotifications = notifications.filter((n) => !n.readAt);

    // Also compute quick counts for the summary chips (backward compat)
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [newLeads, newSessions, openTickets] = await Promise.all([
      db.lead.count({ where: { businessId, status: "new" } }),
      db.chatSession.count({
        where: { businessId, status: "active", createdAt: { gte: since } },
      }),
      db.supportTicket.count({
        where: { businessId, status: { in: ["open", "in_progress"] } },
      }),
    ]);

    return {
      unread: unreadCount,
      counts: { leads: newLeads, sessions: newSessions, tickets: openTickets },
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        data: n.data,
        readAt: n.readAt?.toISOString() || null,
        createdAt: n.createdAt.toISOString(),
      })),
      recentUnread: unreadNotifications.slice(0, 8).map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });
}
