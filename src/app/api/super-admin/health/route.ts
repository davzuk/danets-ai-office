import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { computeTenantHealth } from "@/lib/tenant-health";

// GET /api/super-admin/health — tenant health scores
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() || "";
  const level = req.nextUrl.searchParams.get("level") || "";

  const businesses = await db.business.findMany({
    select: {
      id: true,
      name: true,
      plan: true,
      status: true,
      subscription: { select: { status: true } },
    },
    orderBy: { name: "asc" },
  });

  let rows = await Promise.all(
    businesses.map((b) =>
      computeTenantHealth(
        b.id,
        b.name,
        b.plan,
        b.status,
        b.subscription?.status ?? null
      )
    )
  );

  if (q) {
    rows = rows.filter(
      (r) =>
        r.businessName.toLowerCase().includes(q) ||
        r.plan.toLowerCase().includes(q)
    );
  }
  if (level && level !== "all") {
    rows = rows.filter((r) => r.level === level);
  }

  rows.sort((a, b) => a.score - b.score);

  const summary = {
    healthy: rows.filter((r) => r.level === "healthy").length,
    atRisk: rows.filter((r) => r.level === "at_risk").length,
    critical: rows.filter((r) => r.level === "critical").length,
  };

  return NextResponse.json({ tenants: rows, summary });
}
