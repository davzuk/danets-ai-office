import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// GET /api/super-admin/businesses — list all businesses with stats
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const plan = searchParams.get("plan") || undefined;
  const status = searchParams.get("status") || undefined;

  const where: any = {};
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
    ];
  }
  if (plan) where.plan = plan;
  if (status) where.status = status;

  const businesses = await db.business.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      industry: true,
      plan: true,
      status: true,
      publicKey: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          leads: true,
          chatSessions: true,
          supportTickets: true,
          quoteRequests: true,
          usageLogs: true,
        },
      },
    },
  });

  // Get AI usage per business
  const businessIds = businesses.map((b) => b.id);
  const aiUsage = await db.aiUsageLog.groupBy({
    by: ["businessId"],
    where: { businessId: { in: businessIds } },
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
  });
  const aiMap = new Map(aiUsage.map((a) => [a.businessId, a]));

  return NextResponse.json({
    businesses: businesses.map((b) => {
      const ai = aiMap.get(b.id);
      return {
        id: b.id,
        name: b.name,
        email: b.email,
        industry: b.industry,
        plan: b.plan,
        status: b.status,
        publicKey: b.publicKey,
        createdAt: b.createdAt.toISOString(),
        stats: {
          users: b._count.users,
          leads: b._count.leads,
          chats: b._count.chatSessions,
          tickets: b._count.supportTickets,
          proposals: b._count.quoteRequests,
          aiRequests: b._count.usageLogs,
        },
        aiUsage: ai
          ? {
              tokens: ai._sum.totalTokens || 0,
              costUsd: ai._sum.costUsd || 0,
              requests: ai._count,
            }
          : { tokens: 0, costUsd: 0, requests: 0 },
      };
    }),
  });
}
