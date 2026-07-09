import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { getTenantUsage } from "@/lib/tenant-usage";

// GET /api/super-admin/usage — per-tenant quota usage across the platform
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;

  const where: { OR?: { name: { contains: string } }[] } = {};
  if (q) {
    where.OR = [{ name: { contains: q } }];
  }

  const businesses = await db.business.findMany({
    where,
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, plan: true, status: true },
  });

  const rows = await Promise.all(
    businesses.map(async (b) => {
      const usage = await getTenantUsage(b.id, b.plan);
      const maxPct = Math.max(
        usage.percent.chats,
        usage.percent.leads,
        usage.percent.kbItems,
        usage.percent.aiRequests
      );
      return {
        businessId: b.id,
        businessName: b.name,
        plan: b.plan,
        status: b.status,
        usage,
        maxPercent: maxPct,
      };
    })
  );

  rows.sort((a, b) => b.maxPercent - a.maxPercent);

  return NextResponse.json({ tenants: rows });
}
