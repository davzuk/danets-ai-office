import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/notifications — returns unread counts for the notification bell
export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

    const [newLeads, newSessions, newQuotes, recentLeads] = await Promise.all([
      db.lead.count({ where: { businessId, status: "new" } }),
      db.chatSession.count({
        where: {
          businessId,
          status: "active",
          createdAt: { gte: since },
        },
      }),
      db.quoteRequest.count({
        where: { businessId, status: "draft", createdAt: { gte: since } },
      }),
      db.lead.findMany({
        where: { businessId, status: "new" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          name: true,
          service: true,
          quality: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      unread: newLeads + newSessions + newQuotes,
      counts: { leads: newLeads, sessions: newSessions, quotes: newQuotes },
      recentLeads,
    };
  });
}
