import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@/lib/app-error";
import { siteOrigin, sitesDomain } from "@/lib/sites/host";
import { availableSubdomain, createSite } from "@/lib/sites/service";
import { platformActor, withPlatformAdmin } from "@/lib/sites/platform";

// GET /api/super-admin/sites?q=: every tenant website, with page counts and views.
// ?suggest=<businessId>: a free subdomain for that business (the New site dialog).
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const suggestFor = req.nextUrl.searchParams.get("suggest");
  if (suggestFor) {
    const business = await db.business.findUnique({ where: { id: suggestFor }, select: { name: true, site: { select: { id: true } } } });
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });
    return NextResponse.json({ subdomain: await availableSubdomain(business.name), existingSiteId: business.site?.id ?? null, sitesDomain: sitesDomain() });
  }
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
    sitesDomain: sitesDomain(),
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

// POST /api/super-admin/sites {businessId, subdomain}: set up a tenant's
// website (with a starter home page).
export async function POST(req: NextRequest) {
  return withPlatformAdmin(async (admin) => {
    if (!sitesDomain()) throw new AppError("Websites aren't available on this server (SITES_DOMAIN isn't set).", { status: 503, code: "SITES_NOT_CONFIGURED" });
    const body = (await req.json().catch(() => null)) as { businessId?: unknown; subdomain?: unknown } | null;
    const businessId = typeof body?.businessId === "string" ? body.businessId : "";
    const subdomain = typeof body?.subdomain === "string" ? body.subdomain.trim().toLowerCase() : "";
    const business = businessId ? await db.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } }) : null;
    if (!business) throw new AppError("Choose a business.", { status: 400, code: "INVALID_INPUT" });
    const site = await createSite(platformActor(admin, business.id), subdomain, business.name);
    return { site: { id: site.id, subdomain: site.subdomain, origin: siteOrigin(site.subdomain) } };
  });
}
