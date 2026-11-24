import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { siteOrigin } from "@/lib/sites/host";

// GET /api/super-admin/sites?q=: every tenant website, with page counts and views.
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) || "";
  const sites = await db.tenantSite.findMany({
    where: q ? { OR: [{ subdomain: { contains: q } }, { business: { name: { contains: q } } }] } : undefined,
    include: { business: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const stats = sites.length
    ? await db.landingPage.groupBy({ by: ["siteId", "status"], where: { siteId: { in: sites.map((s) => s.id) } }, _count: { _all: true }, _sum: { views: true } })
    : [];
  return NextResponse.json({
    sites: sites.map((s) => {
      const rows = stats.filter((r) => r.siteId === s.id);
      return {
        id: s.id,
        subdomain: s.subdomain,
        url: siteOrigin(s.subdomain),
        status: s.status,
        widgetEnabled: s.widgetEnabled,
        createdAt: s.createdAt.toISOString(),
        business: s.business,
        pages: rows.reduce((n, r) => n + r._count._all, 0),
        published: rows.filter((r) => r.status === "published").reduce((n, r) => n + r._count._all, 0),
        views: rows.reduce((n, r) => n + (r._sum.views ?? 0), 0),
      };
    }),
  });
}
