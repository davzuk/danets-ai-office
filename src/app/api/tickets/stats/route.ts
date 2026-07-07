import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/tickets/stats — ticket stats for dashboard cards
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;

    const [
      openCount,
      urgentCount,
      pendingCount,
      resolvedCount,
      statusGroups,
      priorityGroups,
    ] = await Promise.all([
      db.supportTicket.count({
        where: { businessId, status: { in: ["open", "in_progress"] } },
      }),
      db.supportTicket.count({
        where: { businessId, priority: "urgent", status: { not: "closed" } },
      }),
      db.supportTicket.count({
        where: { businessId, status: "pending" },
      }),
      db.supportTicket.count({
        where: { businessId, status: "resolved", updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      db.supportTicket.groupBy({
        by: ["status"],
        where: { businessId },
        _count: { _all: true },
      }),
      db.supportTicket.groupBy({
        by: ["priority"],
        where: { businessId },
        _count: { _all: true },
      }),
    ]);

    const knownStatuses = ["open", "pending", "in_progress", "resolved", "closed"];
    const byStatus = knownStatuses.map((status) => {
      const g = statusGroups.find((x) => x.status === status);
      return { status, count: g?._count?._all ?? 0 };
    });

    const knownPriorities = ["low", "medium", "high", "urgent"];
    const byPriority = knownPriorities.map((priority) => {
      const g = priorityGroups.find((x) => x.priority === priority);
      return { priority, count: g?._count?._all ?? 0 };
    });

    return {
      open: openCount,
      urgent: urgentCount,
      awaitingReply: pendingCount,
      recentlyResolved: resolvedCount,
      byStatus,
      byPriority,
    };
  });
}
