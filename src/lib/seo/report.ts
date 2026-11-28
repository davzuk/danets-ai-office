import "server-only";
// The monthly SEO report (Phase 3, workstream Z). On the 3rd of each month,
// once Search Console data for the month is final, Danets gathers the month's
// numbers (search clicks and organic leads, top movers, the site audit,
// reviews and Business Profile actions), asks the AI for three "do this next"
// points, stores the report, and emails it to admins as a PDF. Agencies on
// white-label get it in their own brand so they can forward it.

import { z } from "zod";
import { Prisma, type SeoReport } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification, logActivity } from "@/lib/activity";
import { getBrandContext } from "@/lib/brand";
import { aiStructured, logUsage, AiRefusalError, type AiMessage } from "@/lib/llm";
import { logger, serializeError } from "@/lib/logger";
import { checkMonthlyAiQuota } from "@/lib/plan-limits";
import { escapeHtml, sendEmail } from "@/lib/email";
import { ISSUE_DEFS, isIssueCode } from "./audit-rules";
import { auditView } from "./audit";
import { groupTotals, type LocalTotals } from "./gbp-metrics";
import { safeFetch } from "./fetch";
import {
  addDaysIso,
  aggregateByKey,
  countLeadsByPage,
  endOfMonthIso,
  fromIso,
  lastFinalDay,
  normalizePage,
  PAGE_KIND,
  QUERY_KIND,
  sumMetrics,
  toIso,
  TOTAL_KIND,
  type Totals,
} from "./search";

export const REPORT_FEATURE = "seo_report";
/** Reports kept per tenant (oldest removed first). */
export const KEEP_REPORTS = 24;
/** The scheduled report waits until this day of the month, so the last days' Search Console data is final. */
export const REPORT_DAY = 3;
const MOVERS = 5;
const TOP_PAGES = 5;

// ─── Months (pure) ───────────────────────────────────────────────────

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** First and last day of a "YYYY-MM" month, and of the month before it. Pure. */
export function monthRange(month: string) {
  const from = `${month}-01`;
  const to = endOfMonthIso(from);
  const prevTo = addDaysIso(from, -1);
  const prevFrom = `${prevTo.slice(0, 7)}-01`;
  return { from, to, prevFrom, prevTo };
}

/** The month a report is due for on `now`: the previous calendar month (UTC). Pure. */
export function previousMonth(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ─── The numbers ─────────────────────────────────────────────────────

export interface Mover {
  query: string;
  clicks: number;
  previousClicks: number;
  change: number;
  position: number;
}

export interface ReportData {
  month: string;
  from: string;
  to: string;
  businessName: string;
  search: {
    siteUrl: string;
    /** False when Search Console data for the whole month wasn't in yet. */
    complete: boolean;
    totals: Totals;
    previous: Totals;
    gainers: Mover[];
    losers: Mover[];
    topPages: { page: string; clicks: number; impressions: number; leads: number }[];
  } | null;
  leads: { organic: number; previous: number };
  audit: {
    rootUrl: string;
    score: number | null;
    previousScore: number | null;
    finishedAt: string | null;
    /** The audit ran in this month (otherwise it's the latest one before it). */
    inMonth: boolean;
    pagesCrawled: number;
    /** Null when there was no earlier audit of the site to compare with. */
    fixed: number | null;
    added: number | null;
    top: { label: string; count: number; severity: string }[];
  } | null;
  reviews: {
    count: number;
    previous: number;
    averageRating: number | null;
    replied: number;
    replyRate: number | null;
    overallRating: number | null;
    totalReviews: number;
  } | null;
  local: { totals: LocalTotals; previous: LocalTotals } | null;
}

interface MetricInput {
  date: string;
  kind: string;
  key: string;
  clicks: number;
  impressions: number;
  position: number;
}

/** Queries that gained and lost the most clicks, month on month. Pure. */
export function queryMovers(current: MetricInput[], previous: MetricInput[], n = MOVERS): { gainers: Mover[]; losers: Mover[] } {
  const prev = new Map(aggregateByKey(previous).map((q) => [q.key, q]));
  const cur = new Map(aggregateByKey(current).map((q) => [q.key, q]));
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  const all: Mover[] = [...keys].map((k) => {
    const c = cur.get(k);
    const p = prev.get(k);
    return { query: k, clicks: c?.clicks ?? 0, previousClicks: p?.clicks ?? 0, change: (c?.clicks ?? 0) - (p?.clicks ?? 0), position: Math.round((c?.position ?? p?.position ?? 0) * 10) / 10 };
  });
  const byChange = (a: Mover, b: Mover) => b.change - a.change || b.clicks - a.clicks || a.query.localeCompare(b.query);
  return {
    gainers: all.filter((m) => m.change > 0).sort(byChange).slice(0, n),
    losers: all
      .filter((m) => m.change < 0)
      .sort((a, b) => a.change - b.change || b.previousClicks - a.previousClicks || a.query.localeCompare(b.query))
      .slice(0, n),
  };
}

/** Search numbers for one month from V's stored rows (same sums as the Performance tab). Pure. */
export function searchSection(rows: MetricInput[], range: ReturnType<typeof monthRange>, leadsByPage: Map<string, number>) {
  const inMonth = (r: MetricInput) => r.date >= range.from && r.date <= range.to;
  const inPrev = (r: MetricInput) => r.date >= range.prevFrom && r.date <= range.prevTo;
  const totals = sumMetrics(rows.filter((r) => r.kind === TOTAL_KIND && inMonth(r)));
  const previous = sumMetrics(rows.filter((r) => r.kind === TOTAL_KIND && inPrev(r)));
  const { gainers, losers } = queryMovers(
    rows.filter((r) => r.kind === QUERY_KIND && inMonth(r)),
    rows.filter((r) => r.kind === QUERY_KIND && inPrev(r))
  );
  // The pages that brought the most visitors (clicks), not just the most seen.
  const topPages = aggregateByKey(rows.filter((r) => r.kind === PAGE_KIND && inMonth(r)))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, TOP_PAGES)
    .map((p) => ({ page: p.key, clicks: p.clicks, impressions: p.impressions, leads: leadsByPage.get(normalizePage(p.key) ?? "") ?? 0 }));
  return { totals, previous, gainers, losers, topPages };
}

/** Review counts for one month. Pure. */
export function reviewSection(
  reviews: { reviewCreatedAt: Date; starRating: number; replyStatus: string; replyText: string | null }[],
  range: ReturnType<typeof monthRange>,
  locations: { averageRating: number | null; totalReviewCount: number | null }[]
): NonNullable<ReportData["reviews"]> {
  const day = (d: Date) => toIso(d);
  const month = reviews.filter((r) => day(r.reviewCreatedAt) >= range.from && day(r.reviewCreatedAt) <= range.to);
  const previous = reviews.filter((r) => day(r.reviewCreatedAt) >= range.prevFrom && day(r.reviewCreatedAt) <= range.prevTo).length;
  const rated = month.filter((r) => r.starRating > 0);
  const replied = month.filter((r) => r.replyStatus === "posted" || !!r.replyText).length;
  const withCounts = locations.filter((l) => l.totalReviewCount && l.averageRating != null);
  const totalReviews = withCounts.reduce((n, l) => n + (l.totalReviewCount ?? 0), 0);
  const overall = totalReviews ? withCounts.reduce((n, l) => n + (l.averageRating ?? 0) * (l.totalReviewCount ?? 0), 0) / totalReviews : null;
  return {
    count: month.length,
    previous,
    averageRating: rated.length ? Math.round((rated.reduce((n, r) => n + r.starRating, 0) / rated.length) * 10) / 10 : null,
    replied,
    replyRate: month.length ? replied / month.length : null,
    overallRating: overall == null ? null : Math.round(overall * 10) / 10,
    totalReviews,
  };
}

/** Gather one month's numbers. Reads only stored data (no Google calls). */
export async function collectReport(businessId: string, month: string): Promise<ReportData> {
  const range = monthRange(month);
  const start = fromIso(range.from);
  const end = fromIso(addDaysIso(range.to, 1));
  const prevStart = fromIso(range.prevFrom);
  const [business, property, locations] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    db.searchProperty.findFirst({ where: { businessId, status: "active" }, orderBy: { createdAt: "asc" } }).then(
      (p) => p ?? db.searchProperty.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } })
    ),
    db.businessLocation.findMany({ where: { businessId }, select: { id: true, averageRating: true, totalReviewCount: true } }),
  ]);

  // Organic leads: distinct contacts whose touch came from organic search, as on the Performance tab.
  const touchRows = await db.touchpoint.findMany({
    where: { businessId, channel: "organic_search", contactId: { not: null }, occurredAt: { gte: prevStart, lt: end } },
    select: { landingUrl: true, contactId: true, occurredAt: true },
  });
  const monthTouches = touchRows.filter((t) => t.occurredAt >= start);
  const prevTouches = touchRows.filter((t) => t.occurredAt < start);
  const distinct = (rows: { contactId: string | null }[]) => new Set(rows.map((r) => r.contactId)).size;
  const leads = { organic: distinct(monthTouches), previous: distinct(prevTouches) };

  let search: ReportData["search"] = null;
  if (property) {
    const rows = await db.searchMetricDaily.findMany({
      where: { propertyId: property.id, kind: { in: [TOTAL_KIND, QUERY_KIND, PAGE_KIND] }, date: { gte: prevStart, lte: fromIso(range.to) } },
      select: { date: true, kind: true, key: true, clicks: true, impressions: true, position: true },
    });
    const norm = rows.map((r) => ({ ...r, date: toIso(r.date) }));
    const s = searchSection(norm, range, countLeadsByPage(monthTouches));
    search = {
      siteUrl: property.siteUrl.replace(/^sc-domain:/, ""),
      complete: !!property.syncedThrough && toIso(property.syncedThrough) >= range.to,
      ...s,
    };
  }

  let audit: ReportData["audit"] = null;
  const lastAudit = await db.siteAudit.findFirst({ where: { businessId, status: "done", finishedAt: { lt: end } }, orderBy: { finishedAt: "desc" } });
  if (lastAudit) {
    const view = await auditView(lastAudit);
    const byCode = (lastAudit.summary as { byCode?: Record<string, number> } | null)?.byCode ?? {};
    const order: Record<string, number> = { critical: 0, warning: 1, notice: 2 };
    audit = {
      rootUrl: lastAudit.rootUrl,
      score: lastAudit.score,
      previousScore: view.diff?.previousScore ?? null,
      finishedAt: lastAudit.finishedAt?.toISOString() ?? null,
      inMonth: !!lastAudit.finishedAt && lastAudit.finishedAt >= start,
      pagesCrawled: lastAudit.pagesCrawled,
      fixed: view.diff ? view.diff.fixedCount : null,
      added: view.diff ? view.diff.newCount : null,
      top: Object.entries(byCode)
        .filter(([code]) => isIssueCode(code))
        .map(([code, count]) => ({ label: ISSUE_DEFS[code as keyof typeof ISSUE_DEFS].label, count, severity: ISSUE_DEFS[code as keyof typeof ISSUE_DEFS].severity as string }))
        .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
        .slice(0, 5),
    };
  }

  let reviews: ReportData["reviews"] = null;
  let local: ReportData["local"] = null;
  if (locations.length) {
    const rows = await db.gbpReview.findMany({
      where: { businessId, reviewCreatedAt: { gte: prevStart, lt: end } },
      select: { reviewCreatedAt: true, starRating: true, replyStatus: true, replyText: true },
    });
    reviews = reviewSection(rows, range, locations);
    const [cur, prev] = await Promise.all([
      db.gbpDailyMetric.groupBy({ by: ["metric"], where: { businessId, date: { gte: start, lte: fromIso(range.to) } }, _sum: { value: true } }),
      db.gbpDailyMetric.groupBy({ by: ["metric"], where: { businessId, date: { gte: prevStart, lte: fromIso(range.prevTo) } }, _sum: { value: true } }),
    ]);
    if (cur.length || prev.length) {
      const sum = (g: typeof cur) => groupTotals(g.map((x) => ({ metric: x.metric, value: x._sum.value ?? 0 })));
      local = { totals: sum(cur), previous: sum(prev) };
    }
  }

  return { month, from: range.from, to: range.to, businessName: business?.name ?? "", search, leads, audit, reviews, local };
}

// ─── Next steps (AI) ─────────────────────────────────────────────────

export const nextStepsSchema = z.object({
  summary: z.string().describe("One or two sentences on how the month went, with the most useful number in it."),
  steps: z
    .array(
      z.object({
        title: z.string().describe("A short action, e.g. 'Reply to the 4 unanswered reviews'."),
        detail: z.string().describe("Two or three sentences: what to do and why, quoting the numbers."),
      })
    )
    .length(3),
});
export type NextSteps = z.infer<typeof nextStepsSchema>;

/** The numbers the model is given: compact, with no personal data. Pure. */
export function reportFacts(d: ReportData, opportunities: { kind: string; query: string; potentialClicks: number }[] = []) {
  const pct = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 10);
  return {
    month: monthLabel(d.month),
    search: d.search && {
      site: d.search.siteUrl,
      clicks: d.search.totals.clicks,
      previousClicks: d.search.previous.clicks,
      impressions: d.search.totals.impressions,
      previousImpressions: d.search.previous.impressions,
      ctrPct: pct(d.search.totals.ctr),
      position: Math.round(d.search.totals.position * 10) / 10,
      gainers: d.search.gainers.map((m) => `${m.query} (+${m.change} clicks)`),
      losers: d.search.losers.map((m) => `${m.query} (${m.change} clicks)`),
      topPages: d.search.topPages.map((p) => `${p.page}: ${p.clicks} clicks, ${p.leads} leads`),
    },
    organicLeads: d.leads.organic,
    previousOrganicLeads: d.leads.previous,
    audit: d.audit && { score: d.audit.score, previousScore: d.audit.previousScore, fixed: d.audit.fixed, newIssues: d.audit.added, topIssues: d.audit.top.map((t) => `${t.label} (${t.count})`) },
    reviews: d.reviews && { newReviews: d.reviews.count, previous: d.reviews.previous, averageRating: d.reviews.averageRating, replyRatePct: pct(d.reviews.replyRate), overallRating: d.reviews.overallRating },
    businessProfile: d.local,
    opportunities: opportunities.slice(0, 6).map((o) => `${o.kind.replace(/_/g, " ")}: "${o.query}" (about ${o.potentialClicks} more clicks a month)`),
  };
}

export function nextStepsMessages(brandContext: string, facts: ReturnType<typeof reportFacts>): AiMessage[] {
  const system = [
    "You write the 'do this next' part of a small business's monthly SEO report. The owner is busy and not technical.",
    "",
    brandContext,
    "",
    "Rules:",
    "- Base everything on the numbers given. Quote numbers where they make the point. Never invent results or promise rankings.",
    "- Pick the three actions most likely to bring more customers from Google next month, most valuable first.",
    "- Prefer actions the owner can take in Danets: write a content brief for an opportunity, fix an issue from the site audit, reply to reviews, ask happy customers for reviews, post on the Business Profile.",
    "- If data is missing (no Search Console, no Business Profile, no audit), one step can be to connect or run it.",
    "- Plain language, no jargon, no hype.",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `This month's numbers:\n\n${JSON.stringify(facts, null, 2)}\n\nWrite the summary and the three next steps.` },
  ];
}

// ─── Branding ────────────────────────────────────────────────────────

export interface ReportBrand {
  name: string;
  color: string;
  /** Show "Made with Danets" (off for white-label tenants that hide branding). */
  poweredBy: boolean;
  logo: { data: Buffer; format: "png" | "jpg" } | null;
  logoUrl: string | null;
  whiteLabel: boolean;
}

const DEFAULT_BRAND: ReportBrand = { name: "Danets AI Automation", color: "#1d4ed8", poweredBy: false, logo: null, logoUrl: null, whiteLabel: false };

/** The image format react-pdf can embed, from the bytes. Pure. */
export function imageFormat(bytes: Buffer): "png" | "jpg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/**
 * The brand the report wears: the tenant's white-label brand when it's
 * active, so agencies can forward it, otherwise Danets. The logo is fetched
 * with the SSRF-safe fetcher and only embedded when it's a PNG or JPEG.
 */
export async function reportBrand(businessId: string, opts: { fetchLogo?: boolean } = {}): Promise<ReportBrand> {
  const wl = await db.whiteLabelConfig.findUnique({ where: { businessId } });
  if (!wl?.isActive) return DEFAULT_BRAND;
  const brand: ReportBrand = {
    name: wl.appName || DEFAULT_BRAND.name,
    color: /^#[0-9a-f]{6}$/i.test(wl.primaryColor) ? wl.primaryColor : DEFAULT_BRAND.color,
    poweredBy: !wl.hideBranding,
    logo: null,
    logoUrl: wl.customLogoUrl,
    whiteLabel: true,
  };
  if (wl.customLogoUrl && opts.fetchLogo !== false) {
    try {
      const res = await safeFetch(wl.customLogoUrl, { timeoutMs: 8000, maxBytes: 1_000_000, accept: "image/png,image/jpeg" });
      const format = res.status === 200 && !res.truncated ? imageFormat(res.bytes) : null;
      if (format) brand.logo = { data: res.bytes, format };
    } catch (e) {
      logger.info("Report logo not fetched", { businessId, ...serializeError(e) });
    }
  }
  return brand;
}

// ─── Creating, reading, sending ──────────────────────────────────────

export const publicReportSummary = (r: SeoReport) => {
  const d = r.data as unknown as ReportData;
  return {
    id: r.id,
    month: r.month,
    label: monthLabel(r.month),
    clicks: d.search?.totals.clicks ?? null,
    organicLeads: d.leads.organic,
    trigger: r.trigger,
    createdAt: r.createdAt,
    emailedAt: r.emailedAt,
    emailError: r.emailError,
  };
};

export const publicReport = (r: SeoReport) => ({
  ...publicReportSummary(r),
  data: r.data as unknown as ReportData,
  nextSteps: (r.nextSteps as NextSteps | null) ?? null,
  aiError: r.aiError,
});
export type PublicReport = ReturnType<typeof publicReport>;

export async function listReports(businessId: string) {
  const rows = await db.seoReport.findMany({ where: { businessId }, orderBy: { month: "desc" }, take: KEEP_REPORTS });
  return rows.map(publicReportSummary);
}

export async function getReport(businessId: string, id: string) {
  const r = await db.seoReport.findFirst({ where: { id, businessId } });
  if (!r) throw new AppError("Report not found", { status: 404, code: "NOT_FOUND" });
  return r;
}

async function writeNextSteps(businessId: string, data: ReportData): Promise<{ nextSteps: NextSteps | null; aiError: string | null }> {
  const quota = await checkMonthlyAiQuota(businessId);
  if (!quota.allowed) return { nextSteps: null, aiError: "No AI credits were left this month, so there are no next steps in this report." };
  const opportunities = await db.seoOpportunity.findMany({
    where: { businessId, dismissedAt: null },
    orderBy: { potentialClicks: "desc" },
    take: 6,
    select: { kind: true, query: true, potentialClicks: true },
  });
  const messages = nextStepsMessages(await getBrandContext(businessId), reportFacts(data, opportunities));
  try {
    const result = await aiStructured(messages, nextStepsSchema, { businessId, task: "plan", maxTokens: 1500 });
    await logUsage(businessId, REPORT_FEATURE, result);
    return { nextSteps: result.data, aiError: null };
  } catch (e) {
    await logUsage(businessId, REPORT_FEATURE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", (e as Error).message);
    logger.warn("SEO report next steps failed", { businessId, ...serializeError(e) });
    return { nextSteps: null, aiError: e instanceof AiRefusalError ? "The AI declined to write next steps for this report." : "The AI couldn't write next steps this time." };
  }
}

export interface GenerateOptions {
  trigger?: "schedule" | "manual" | "platform";
  by?: string | null;
  /** Email the PDF to admins (when the tenant's setting allows it). */
  email?: boolean;
  notify?: boolean;
  now?: Date;
}

/** Build, store (replacing the month's earlier report) and optionally send one report. */
export async function generateReport(businessId: string, month: string, opts: GenerateOptions = {}) {
  if (!isMonth(month)) throw new AppError("Pick a month.", { status: 400, code: "INVALID_REQUEST" });
  const range = monthRange(month);
  if (range.from > toIso(opts.now ?? new Date())) throw new AppError("That month hasn't started yet.", { status: 400, code: "INVALID_REQUEST" });

  const data = await collectReport(businessId, month);
  const { nextSteps, aiError } = await writeNextSteps(businessId, data);
  const fields = {
    periodStart: fromIso(range.from),
    periodEnd: fromIso(range.to),
    data: data as unknown as object,
    nextSteps: nextSteps ? (nextSteps as object) : Prisma.DbNull,
    aiError,
    trigger: opts.trigger ?? "schedule",
    createdBy: opts.by?.slice(0, 120) ?? null,
    emailedAt: null,
    emailError: null,
  };
  const row = await db.seoReport.upsert({
    where: { businessId_month: { businessId, month } },
    create: { businessId, month, ...fields },
    update: { ...fields, createdAt: new Date() },
  });
  await pruneReports(businessId);
  if (opts.notify !== false) {
    await createNotification({
      businessId,
      type: "seo_report",
      title: `Your SEO report for ${monthLabel(month)} is ready`,
      message: nextSteps?.summary ?? reportHeadline(data),
      data: { view: "seo", reportId: row.id, month },
    });
  }
  let report = row;
  if (opts.email) {
    const settings = await db.seoSettings.findUnique({ where: { businessId }, select: { reportEmail: true } });
    if (settings?.reportEmail !== false) report = (await emailReport(row).catch(() => null)) ?? row;
  }
  return publicReport(report);
}

async function pruneReports(businessId: string) {
  const old = await db.seoReport.findMany({ where: { businessId }, orderBy: { month: "desc" }, skip: KEEP_REPORTS, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/** One plain sentence for notifications and the email when the AI wrote nothing. Pure. */
export function reportHeadline(d: ReportData): string {
  const parts: string[] = [];
  if (d.search) parts.push(`${d.search.totals.clicks.toLocaleString("en-GB")} clicks from Google search (${d.search.previous.clicks.toLocaleString("en-GB")} the month before)`);
  parts.push(`${d.leads.organic} lead${d.leads.organic === 1 ? "" : "s"} from organic search`);
  if (d.reviews) parts.push(`${d.reviews.count} new review${d.reviews.count === 1 ? "" : "s"}`);
  return `${monthLabel(d.month)}: ${parts.join(", ")}.`;
}

export function reportFileName(businessName: string, month: string) {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "seo";
  return `${slug}-seo-report-${month}.pdf`;
}

export async function renderReportPdfFor(row: SeoReport) {
  const { renderReportPdf } = await import("./report-pdf");
  const brand = await reportBrand(row.businessId);
  const r = publicReport(row);
  return renderReportPdf({ data: r.data, nextSteps: r.nextSteps, brand });
}

/** The email's HTML: short, branded, with the PDF attached. Every value is escaped. Pure. */
export function reportEmailHtml(d: ReportData, steps: NextSteps | null, brand: Pick<ReportBrand, "name" | "color" | "poweredBy">) {
  const e = (s: string) => escapeHtml(s);
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">${e(k)}</td><td style="padding:6px 0;font-weight:600;font-size:14px;text-align:right;">${e(v)}</td></tr>`;
  const rows = [
    d.search ? row("Clicks from Google", `${d.search.totals.clicks.toLocaleString("en-GB")} (was ${d.search.previous.clicks.toLocaleString("en-GB")})`) : "",
    row("Leads from organic search", `${d.leads.organic} (was ${d.leads.previous})`),
    d.audit?.score != null ? row("Site audit score", `${d.audit.score}/100`) : "",
    d.reviews ? row("New reviews", `${d.reviews.count}${d.reviews.averageRating != null ? `, average ${d.reviews.averageRating}★` : ""}`) : "",
  ].join("");
  const stepsHtml = steps
    ? `<h2 style="margin:20px 0 8px;font-size:16px;color:#1a1a2e;">Do this next</h2><ol style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">${steps.steps
        .map((s) => `<li style="margin-bottom:8px;"><strong>${e(s.title)}</strong><br>${e(s.detail)}</li>`)
        .join("")}</ol>`
    : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:20px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;">
      <div style="background:${e(brand.color)};padding:22px 28px;color:#fff;font-size:18px;font-weight:700;">${e(brand.name)}</div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 6px;font-size:21px;color:#1a1a2e;">SEO report: ${e(monthLabel(d.month))}</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.6;">${e(steps?.summary ?? reportHeadline(d))}</p>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        ${stepsHtml}
        <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">The full report for ${e(d.businessName)} is attached as a PDF.</p>
      </div>
      ${brand.poweredBy ? `<div style="padding:14px 28px;background:#f9fafb;font-size:11px;color:#9ca3af;">Made with Danets AI Automation</div>` : ""}
    </div>
  </div>
</body></html>`;
}

/** Email the report PDF to the tenant's admins. Records when it went, or why it didn't. */
export async function emailReport(row: SeoReport): Promise<SeoReport> {
  const admins = await db.businessUser.findMany({ where: { businessId: row.businessId, role: "admin" }, select: { email: true } });
  const r = publicReport(row);
  let error: string | null = null;
  let sent = 0;
  if (!admins.length) error = "No admins to email.";
  else {
    try {
      const brand = await reportBrand(row.businessId);
      const { renderReportPdf } = await import("./report-pdf");
      const pdfBuf = await renderReportPdf({ data: r.data, nextSteps: r.nextSteps, brand });
      const html = reportEmailHtml(r.data, r.nextSteps, brand);
      const text = `${r.nextSteps?.summary ?? reportHeadline(r.data)}\n\nThe full SEO report for ${monthLabel(row.month)} is attached as a PDF.`;
      for (const a of admins) {
        const res = await sendEmail({
          to: a.email,
          subject: `SEO report for ${r.data.businessName || "your business"}: ${monthLabel(row.month)}`,
          html,
          text,
          attachments: [{ filename: reportFileName(r.data.businessName, row.month), content: pdfBuf, contentType: "application/pdf" }],
        });
        if (res.success) sent++;
        else error = res.error ?? "The email couldn't be sent.";
      }
    } catch (e) {
      error = (e as Error).message || "The report couldn't be emailed.";
      logger.warn("SEO report email failed", { businessId: row.businessId, ...serializeError(e) });
    }
  }
  return db.seoReport.update({ where: { id: row.id }, data: sent ? { emailedAt: new Date(), emailError: null } : { emailError: error?.slice(0, 500) ?? null } });
}

// ─── Settings ────────────────────────────────────────────────────────

export const reportSettingsSchema = z.object({ reportEmail: z.boolean() });

export async function saveReportSettings(actor: { businessId: string; userId?: string; name: string; role: string }, input: z.infer<typeof reportSettingsSchema>) {
  if (actor.role !== "admin") throw new AppError("Only admins can change SEO settings.", { status: 403, code: "FORBIDDEN" });
  await db.seoSettings.upsert({ where: { businessId: actor.businessId }, create: { businessId: actor.businessId, ...input }, update: input });
  await logActivity({
    businessId: actor.businessId,
    userId: actor.userId,
    userName: actor.name,
    action: "business_settings_changed",
    module: "seo",
    description: input.reportEmail ? "Turned on the monthly SEO report email" : "Turned off the monthly SEO report email",
  });
  return input;
}

// ─── Weekly insights (M) ─────────────────────────────────────────────

/**
 * Reviews and Business Profile lines for the weekly AI insight: new reviews,
 * their average rating and replies over the last `days`, and the profile's
 * calls, website clicks and directions. Null when there are no locations.
 */
export async function localSummary(businessId: string, days = 28, now: Date = new Date()): Promise<string | null> {
  const locations = await db.businessLocation.findMany({ where: { businessId }, select: { averageRating: true, totalReviewCount: true } });
  if (!locations.length) return null;
  const to = toIso(now);
  const from = addDaysIso(to, -(days - 1));
  const range = { from, to, prevFrom: addDaysIso(from, -days), prevTo: addDaysIso(from, -1) };
  const reviews = await db.gbpReview.findMany({
    where: { businessId, reviewCreatedAt: { gte: fromIso(range.prevFrom) } },
    select: { reviewCreatedAt: true, starRating: true, replyStatus: true, replyText: true },
  });
  const r = reviewSection(reviews, range, locations);
  const metricsTo = lastFinalDay(now);
  const metrics = await db.gbpDailyMetric.groupBy({ by: ["metric"], where: { businessId, date: { gte: fromIso(addDaysIso(metricsTo, -(days - 1))), lte: fromIso(metricsTo) } }, _sum: { value: true } });
  const t = groupTotals(metrics.map((m) => ({ metric: m.metric, value: m._sum.value ?? 0 })));
  const parts = [
    `Google reviews (last ${days} days): ${r.count} new (${r.previous} the prior ${days} days)${r.averageRating != null ? `, average ${r.averageRating} stars` : ""}${r.count ? `, ${r.replied} replied to` : ""}.${r.overallRating != null ? ` Overall ${r.overallRating} stars from ${r.totalReviews} reviews.` : ""}`,
  ];
  if (metrics.length) parts.push(`Business Profile: ${t.searchViews + t.mapsViews} views, ${t.calls} calls, ${t.websiteClicks} website clicks, ${t.directions} direction requests.`);
  return parts.join(" ");
}

/** Tenants due a report for `month` (have SEO set up, no report yet). */
export async function dueForReport(month: string): Promise<string[]> {
  const [props, locs, audits, done] = await Promise.all([
    db.searchProperty.findMany({ distinct: ["businessId"], select: { businessId: true } }),
    db.businessLocation.findMany({ distinct: ["businessId"], select: { businessId: true } }),
    db.siteAudit.findMany({ where: { status: "done" }, distinct: ["businessId"], select: { businessId: true } }),
    db.seoReport.findMany({ where: { month }, select: { businessId: true } }),
  ]);
  const skip = new Set(done.map((d) => d.businessId));
  return [...new Set([...props, ...locs, ...audits].map((x) => x.businessId))].filter((b) => !skip.has(b));
}
