import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

const VALID_MODULES = [
  "auth", "team", "business", "agent", "knowledge", "leads",
  "quotes", "tickets", "documents", "integrations", "subscription",
];

// GET /api/super-admin/audit-logs — cross-tenant activity timeline
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId") || undefined;
  const moduleFilter = searchParams.get("module") || undefined;
  const action = searchParams.get("action") || undefined;
  const q = searchParams.get("q")?.trim() || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 200);

  const where: Record<string, unknown> = {};
  if (businessId) where.businessId = businessId;
  if (moduleFilter && VALID_MODULES.includes(moduleFilter)) where.module = moduleFilter;
  if (action) where.action = action;
  if (q) {
    where.OR = [{ description: { contains: q } }, { userName: { contains: q } }];
  }

  const logs = await db.activityLog.findMany({
    where: where as Prisma.ActivityLogWhereInput,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      business: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      businessId: l.businessId,
      businessName: l.business.name,
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
  });
}
