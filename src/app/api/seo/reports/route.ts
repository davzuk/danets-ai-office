import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { db } from "@/lib/db";
import { generateReport, isMonth, listReports, previousMonth, reportBrand, reportSettingsSchema, saveReportSettings } from "@/lib/seo/report";

export const maxDuration = 90;
/** A month's report can be re-created at most once an hour. */
const REBUILD_GAP_MS = 60 * 60_000;

// GET /api/seo/reports: the monthly reports, the email setting and the brand they wear.
export async function GET() {
  return withSession(async (user) => {
    const [reports, settings, brand] = await Promise.all([
      listReports(user.businessId),
      db.seoSettings.findUnique({ where: { businessId: user.businessId }, select: { reportEmail: true } }),
      reportBrand(user.businessId, { fetchLogo: false }),
    ]);
    return {
      reports,
      settings: { reportEmail: settings?.reportEmail ?? true },
      brand: { name: brand.name, color: brand.color, logoUrl: brand.logoUrl, whiteLabel: brand.whiteLabel, poweredBy: brand.poweredBy },
      lastMonth: previousMonth(),
      canEdit: user.role === "admin",
    };
  });
}

// POST {month}: create (or re-create) a month's report now (admin). Not emailed.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const body = (await req.json().catch(() => null)) as { month?: unknown } | null;
    const month = typeof body?.month === "string" && isMonth(body.month) ? body.month : previousMonth();
    const existing = await db.seoReport.findUnique({ where: { businessId_month: { businessId: user.businessId, month } }, select: { createdAt: true, trigger: true } });
    if (existing && existing.trigger !== "schedule" && Date.now() - existing.createdAt.getTime() < REBUILD_GAP_MS) {
      throw new AppError("This report was just created. Try again in an hour.", { status: 429, code: "TOO_SOON" });
    }
    return { report: await generateReport(user.businessId, month, { trigger: "manual", by: user.name, email: false }) };
  });
}

// PATCH {reportEmail}: email the monthly report to admins, or not (admin).
export async function PATCH(req: NextRequest) {
  return withSession(async (user) => {
    const parsed = reportSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return { settings: await saveReportSettings({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, parsed.data) };
  });
}
