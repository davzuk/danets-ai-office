import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/conversations?status=active|ended|handover&q=<search>
// Lists ChatSessions for the user's business, with latest message + lead included.
// Ordered by updatedAt desc, limited to 100 rows.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const q = url.searchParams.get("q")?.trim() || undefined;

    if (status && !["active", "ended", "handover"].includes(status)) {
      return { sessions: [], error: "Invalid status filter" };
    }

    const where: any = { businessId: user.businessId };
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { visitorName: { contains: q } },
        { visitorEmail: { contains: q } },
      ];
    }

    const rows = await db.chatSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        lead: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    const sessions = rows.map((s) => ({
      id: s.id,
      businessId: s.businessId,
      agentId: s.agentId,
      visitorName: s.visitorName,
      visitorEmail: s.visitorEmail,
      visitorPhone: s.visitorPhone,
      visitorId: s.visitorId,
      status: s.status,
      summary: s.summary,
      leadQuality: s.leadQuality,
      nextAction: s.nextAction,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lead: s.lead,
      latestMessage: s.messages[0] || null,
    }));

    return { sessions };
  });
}
