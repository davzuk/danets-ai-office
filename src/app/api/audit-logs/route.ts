import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const VALID_MODULES = [
  "auth", "team", "business", "agent", "knowledge", "leads",
  "quotes", "tickets", "documents", "integrations", "subscription",
];

// GET /api/audit-logs — list activity logs for the business
// Supports ?module=, ?action=, ?q= (search description), ?limit=
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const moduleFilter = searchParams.get("module") || undefined;
    const action = searchParams.get("action") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 200);

    const where: any = { businessId: user.businessId };
    if (moduleFilter && VALID_MODULES.includes(moduleFilter)) where.module = moduleFilter;
    if (action) where.action = action;
    if (q) {
      where.OR = [
        { description: { contains: q } },
        { userName: { contains: q } },
      ];
    }

    const logs = await db.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return {
      logs: logs.map((l) => ({
        id: l.id,
        userId: l.userId,
        userName: l.userName,
        action: l.action,
        module: l.module,
        description: l.description,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
        metadata: l.metadata,
        createdAt: l.createdAt.toISOString(),
      })),
      total: logs.length,
    };
  });
}
