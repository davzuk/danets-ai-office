import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { AppError } from "@/lib/app-error";
import { checkBusiness, publicLocation, publicProperty } from "@/lib/seo/setup";
import { ISSUE_DEFS, isIssueCode } from "@/lib/seo/audit-rules";
import { startAudit } from "@/lib/seo/audit";
import { enqueueAuditRun } from "@/lib/jobs/handlers/seo-audit";
import { removeLocationAccount } from "@/lib/seo/gbp-account";
import { enqueueReviewsSync } from "@/lib/jobs/handlers/gbp-sync";
import { briefToPagePrompt, type BriefData } from "@/lib/seo/briefs";
import { generateReport, getReport, previousMonth, publicReportSummary, renderReportPdfFor, reportFileName, type ReportData } from "@/lib/seo/report";

type Ctx = { params: Promise<{ id: string }> };

async function view(businessId: string) {
  const [properties, locations, audit, unreplied, awaiting, keywordCount, opportunityCounts, briefs, reports] = await Promise.all([
    db.searchProperty.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.businessLocation.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.siteAudit.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } }),
    db.gbpReview.groupBy({ by: ["locationId"], where: { businessId, replyStatus: { notIn: ["posted", "pending_approval"] } }, _count: { _all: true } }),
    db.gbpReview.groupBy({ by: ["locationId"], where: { businessId, replyStatus: "pending_approval" }, _count: { _all: true } }),
    db.trackedKeyword.count({ where: { businessId } }),
    db.seoOpportunity.groupBy({ by: ["kind"], where: { businessId, dismissedAt: null }, _count: { _all: true } }),
    db.contentBrief.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.seoReport.findMany({ where: { businessId }, orderBy: { month: "desc" }, take: 3 }),
  ]);
  const countOf = (rows: { locationId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.locationId === id)?._count._all ?? 0;
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
  return {
    properties: properties.map(publicProperty),
    // Each location with its reviews state, so the platform can see a tenant
    // falling behind on replies or a sync that keeps failing.
    locations: locations.map((l) => ({
      ...publicLocation(l),
      averageRating: l.averageRating,
      totalReviewCount: l.totalReviewCount,
      reviewsSyncedAt: l.reviewsSyncedAt,
      reviewsError: l.reviewsError,
      metricsError: l.metricsError,
      unreplied: countOf(unreplied, l.id),
      awaitingApproval: countOf(awaiting, l.id),
    })),
    audit: latestAudit,
    // Keywords and content (workstream Y): the platform can turn a tenant's
    // brief into a page-builder prompt for a site it builds.
    content: {
      keywords: keywordCount,
      opportunities: Object.fromEntries(opportunityCounts.map((o) => [o.kind, o._count._all])),
      briefs: briefs.map((b) => ({
        id: b.id,
        query: b.query,
        title: b.title,
        gaps: b.gaps,
        createdAt: b.createdAt,
        pagePrompt: briefToPagePrompt(b.brief as unknown as BriefData, b.query),
      })),
    },
    // Monthly reports (workstream Z): the platform can create one and download its PDF.
    reports: { lastMonth: previousMonth(), items: reports.map((r) => ({ ...publicReportSummary(r), aiError: r.aiError })) },
  };
}

// GET /api/super-admin/businesses/<id>/seo: the tenant's Search Console
// properties and Business Profile locations, with their last check.
// ?reportPdf=<reportId> downloads a monthly report's PDF.
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  if (!(await db.business.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const reportId = new URL(req.url).searchParams.get("reportPdf");
  if (reportId) {
    let row;
    try {
      row = await getReport(id, reportId);
    } catch {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    const body = await renderReportPdfFor(row);
    const name = reportFileName((row.data as unknown as ReportData).businessName, row.month);
    return new NextResponse(new Uint8Array(body), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Content-Length": String(body.byteLength), "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.json(await view(id));
}

// POST {action: "check"} re-checks access now; {action: "audit"} starts a
// site audit (no hourly limit); {action: "sync_reviews", itemId} queues a
// Business Profile reviews sync; {action: "report"} creates last month's SEO
// report; {action: "remove", kind, itemId} clears a
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
  if (body?.action === "report") {
    // Last month's report, created now for the tenant (not emailed).
    const month = previousMonth();
    try {
      await generateReport(id, month, { trigger: "platform", by: `${auth.user.name} (Super Admin)`, email: false });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json(e.toResponseBody(), { status: e.status });
      throw e;
    }
    await logActivity({ businessId: id, userName: `${auth.user.name} (Super Admin)`, action: "create", module: "seo", description: `Platform created the SEO report for ${month}` });
    return NextResponse.json(await view(id));
  }
  if (body?.action === "sync_reviews" && typeof body.itemId === "string") {
    const loc = await db.businessLocation.findFirst({ where: { id: body.itemId, businessId: id } });
    if (!loc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (loc.status === "lost_access") return NextResponse.json({ error: "This location has lost access. The tenant needs to reconnect Google first." }, { status: 409 });
    await enqueueReviewsSync(loc.id, id);
    return NextResponse.json(await view(id));
  }
  if (body?.action === "remove" && (body.kind === "property" || body.kind === "location") && typeof body.itemId === "string") {
    const label =
      body.kind === "property"
        ? (await db.searchProperty.findFirst({ where: { id: body.itemId, businessId: id } }))?.siteUrl
        : (await db.businessLocation.findFirst({ where: { id: body.itemId, businessId: id } }))?.title;
    if (!label) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (body.kind === "property") await db.searchProperty.delete({ where: { id: body.itemId } });
    else {
      const loc = await db.businessLocation.findUniqueOrThrow({ where: { id: body.itemId } });
      await removeLocationAccount(loc);
      await db.businessLocation.delete({ where: { id: loc.id } });
    }
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
