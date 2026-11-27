import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { AppError } from "@/lib/app-error";
import { checkBusiness, publicLocation, publicProperty } from "@/lib/seo/setup";
import { ISSUE_DEFS, isIssueCode } from "@/lib/seo/audit-rules";
import { startAudit } from "@/lib/seo/audit";
import { enqueueAuditRun } from "@/lib/jobs/handlers/seo-audit";

type Ctx = { params: Promise<{ id: string }> };

async function view(businessId: string) {
  const [properties, locations, audit] = await Promise.all([
    db.searchProperty.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.businessLocation.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.siteAudit.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } }),
  ]);
  // The latest site audit and its biggest issue kinds, so the platform can
  // fix them on a platform-built site.
  let latestAudit: Record<string, unknown> | null = null;
  if (audit) {
    const byCode = (audit.summary as { byCode?: Record<string, number> } | null)?.byCode ?? {};
    const order = { critical: 0, warning: 1, notice: 2 };
    const top = Object.entries(byCode)
      .filter(([code]) => isIssueCode(code))
      .map(([code, count]) => ({ code, count, label: ISSUE_DEFS[code as keyof typeof ISSUE_DEFS].label, severity: ISSUE_DEFS[code as keyof typeof ISSUE_DEFS].severity }))
      .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
      .slice(0, 6);
    latestAudit = {
      id: audit.id,
      rootUrl: audit.rootUrl,
      status: audit.status,
      trigger: audit.trigger,
      score: audit.score,
      pagesCrawled: audit.pagesCrawled,
      error: audit.error,
      createdAt: audit.createdAt,
      finishedAt: audit.finishedAt,
      top,
    };
  }
  return { properties: properties.map(publicProperty), locations: locations.map(publicLocation), audit: latestAudit };
}

// GET /api/super-admin/businesses/<id>/seo: the tenant's Search Console
// properties and Business Profile locations, with their last check.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  if (!(await db.business.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  return NextResponse.json(await view(id));
}

// POST {action: "check"} re-checks access now; {action: "audit"} starts a
// site audit (no hourly limit); {action: "remove", kind, itemId} clears a
// property or location (e.g. one that belongs to someone else).
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; kind?: unknown; itemId?: unknown } | null;
  if (body?.action === "check") {
    await checkBusiness(id);
    return NextResponse.json(await view(id));
  }
  if (body?.action === "audit") {
    try {
      await startAudit({ businessId: id, name: `${auth.user.name} (Super Admin)` }, "platform", enqueueAuditRun);
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json(e.toResponseBody(), { status: e.status });
      throw e;
    }
    return NextResponse.json(await view(id));
  }
  if (body?.action === "remove" && (body.kind === "property" || body.kind === "location") && typeof body.itemId === "string") {
    const label =
      body.kind === "property"
        ? (await db.searchProperty.findFirst({ where: { id: body.itemId, businessId: id } }))?.siteUrl
        : (await db.businessLocation.findFirst({ where: { id: body.itemId, businessId: id } }))?.title;
    if (!label) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (body.kind === "property") await db.searchProperty.delete({ where: { id: body.itemId } });
    else await db.businessLocation.delete({ where: { id: body.itemId } });
    await logActivity({
      businessId: id,
      userName: `${auth.user.name} (Super Admin)`,
      action: "delete",
      module: "seo",
      description: `Platform removed the ${body.kind === "property" ? "Search Console property" : "Business Profile location"} ${label}`,
    });
    return NextResponse.json(await view(id));
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
