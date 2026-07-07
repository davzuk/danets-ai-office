import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/leads/[id]/activities — activity timeline for a lead
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const activities = await db.leadActivity.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return {
      activities: activities.map((a) => ({
        id: a.id,
        type: a.type,
        description: a.description,
        actorName: a.actorName,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });
}
