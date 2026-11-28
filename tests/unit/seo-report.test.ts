import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {}, createNotification: async () => {} }));
vi.mock("@/lib/brand", () => ({ getBrandContext: async () => "" }));
vi.mock("@/lib/llm", () => ({ aiStructured: vi.fn(), logUsage: async () => {}, AiRefusalError: class extends Error {} }));
vi.mock("@/lib/plan-limits", () => ({ checkMonthlyAiQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
  escapeHtml: (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!),
}));
vi.mock("@/lib/seo/audit", () => ({ auditView: async () => ({ diff: null }) }));

import {
  imageFormat,
  isMonth,
  monthRange,
  previousMonth,
  queryMovers,
  reportEmailHtml,
  reportFacts,
  reportFileName,
  reportHeadline,
  reviewSection,
  searchSection,
  type ReportData,
} from "@/lib/seo/report";
import { renderReportPdf } from "@/lib/seo/report-pdf";

const row = (date: string, kind: string, key: string, clicks: number, impressions: number, position: number) => ({ date, kind, key, clicks, impressions, position });

describe("months", () => {
  it("works out the month and the one before", () => {
    expect(monthRange("2026-03")).toEqual({ from: "2026-03-01", to: "2026-03-31", prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    expect(monthRange("2026-01")).toMatchObject({ prevFrom: "2025-12-01", prevTo: "2025-12-31" });
    expect(previousMonth(new Date("2026-12-03T08:00:00Z"))).toBe("2026-11");
    expect(previousMonth(new Date("2027-01-03T08:00:00Z"))).toBe("2026-12");
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
  });
});

describe("search section on a seeded month", () => {
  const range = monthRange("2026-10");
  // October: two days of totals; September: one. Queries move both ways.
  const rows = [
    row("2026-10-01", "total", "", 30, 1000, 10),
    row("2026-10-31", "total", "", 20, 1000, 6),
    row("2026-09-15", "total", "", 40, 2000, 12),
    row("2026-10-05", "query", "boiler repair", 25, 300, 4),
    row("2026-09-05", "query", "boiler repair", 5, 200, 9),
    row("2026-10-05", "query", "plumber leeds", 2, 100, 7),
    row("2026-09-05", "query", "plumber leeds", 12, 150, 5),
    row("2026-10-05", "query", "new search", 3, 50, 11),
    row("2026-10-05", "page", "https://acme.test/boiler/", 25, 300, 4),
    row("2026-10-05", "page", "https://acme.test/", 5, 400, 8),
    row("2026-11-01", "total", "", 99, 999, 1), // outside both months
  ];

  it("matches the hand-computed numbers", () => {
    const leads = new Map([["https://acme.test/boiler", 2]]);
    const s = searchSection(rows, range, leads);
    // 50 clicks, 2000 impressions, position (10*1000 + 6*1000) / 2000 = 8.
    expect(s.totals).toEqual({ clicks: 50, impressions: 2000, ctr: 0.025, position: 8 });
    expect(s.previous).toEqual({ clicks: 40, impressions: 2000, ctr: 0.02, position: 12 });
    expect(s.gainers.map((m) => [m.query, m.change])).toEqual([
      ["boiler repair", 20],
      ["new search", 3],
    ]);
    expect(s.losers.map((m) => [m.query, m.change, m.position])).toEqual([["plumber leeds", -10, 7]]);
    expect(s.topPages).toEqual([
      { page: "https://acme.test/boiler/", clicks: 25, impressions: 300, leads: 2 },
      { page: "https://acme.test/", clicks: 5, impressions: 400, leads: 0 },
    ]);
  });

  it("queryMovers counts a query that disappeared as a loser", () => {
    const m = queryMovers([], [row("2026-09-01", "query", "gone", 4, 10, 3)]);
    expect(m.losers).toEqual([{ query: "gone", clicks: 0, previousClicks: 4, change: -4, position: 3 }]);
  });
});

describe("review section", () => {
  it("counts the month's reviews, rating and replies", () => {
    const at = (d: string) => new Date(`${d}T12:00:00Z`);
    const r = reviewSection(
      [
        { reviewCreatedAt: at("2026-10-02"), starRating: 5, replyStatus: "posted", replyText: "Thanks" },
        { reviewCreatedAt: at("2026-10-20"), starRating: 2, replyStatus: "none", replyText: null },
        { reviewCreatedAt: at("2026-10-31"), starRating: 4, replyStatus: "draft", replyText: null },
        { reviewCreatedAt: at("2026-09-30"), starRating: 5, replyStatus: "posted", replyText: "x" },
      ],
      monthRange("2026-10"),
      [
        { averageRating: 4.5, totalReviewCount: 30 },
        { averageRating: 4.0, totalReviewCount: 10 },
      ]
    );
    expect(r).toEqual({ count: 3, previous: 1, averageRating: 3.7, replied: 1, replyRate: 1 / 3, overallRating: 4.4, totalReviews: 40 });
  });
});

const data: ReportData = {
  month: "2026-10",
  from: "2026-10-01",
  to: "2026-10-31",
  businessName: "Acme <Plumbing>",
  search: {
    siteUrl: "acme.test",
    complete: true,
    totals: { clicks: 50, impressions: 2000, ctr: 0.025, position: 8 },
    previous: { clicks: 40, impressions: 2000, ctr: 0.02, position: 12 },
    gainers: [{ query: "boiler repair", clicks: 25, previousClicks: 5, change: 20, position: 4 }],
    losers: [],
    topPages: [{ page: "https://acme.test/boiler/", clicks: 25, impressions: 300, leads: 2 }],
  },
  leads: { organic: 3, previous: 1 },
  audit: { rootUrl: "https://acme.test/", score: 82, previousScore: 74, finishedAt: "2026-10-10T00:00:00Z", inMonth: true, pagesCrawled: 40, fixed: 6, added: 1, top: [{ label: "Missing meta description", count: 4, severity: "warning" }] },
  reviews: { count: 3, previous: 1, averageRating: 3.7, replied: 1, replyRate: 1 / 3, overallRating: 4.4, totalReviews: 40 },
  local: {
    totals: { searchViews: 100, mapsViews: 50, calls: 7, websiteClicks: 12, directions: 3, messages: 0 },
    previous: { searchViews: 80, mapsViews: 40, calls: 5, websiteClicks: 10, directions: 4, messages: 0 },
  },
};

describe("text, email and branding", () => {
  it("writes a headline and the AI facts", () => {
    expect(reportHeadline(data)).toBe("October 2026: 50 clicks from Google search (40 the month before), 3 leads from organic search, 3 new reviews.");
    const f = reportFacts(data, [{ kind: "almost_page_one", query: "boiler repair", potentialClicks: 9 }]);
    expect(f.search?.gainers).toEqual(["boiler repair (+20 clicks)"]);
    expect(f.opportunities).toEqual(['almost page one: "boiler repair" (about 9 more clicks a month)']);
    expect(f.reviews?.replyRatePct).toBe(33.3);
  });

  it("brands and escapes the email", () => {
    const html = reportEmailHtml(data, { summary: "Good <month>", steps: [{ title: "Reply", detail: "Do it" }, { title: "A", detail: "B" }, { title: "C", detail: "D" }] }, { name: "Agency & Co", color: "#ff0000", poweredBy: false });
    expect(html).toContain("Agency &amp; Co");
    expect(html).toContain("background:#ff0000");
    expect(html).toContain("Good &lt;month&gt;");
    expect(html).toContain("Acme &lt;Plumbing&gt;");
    expect(html).not.toContain("Made with Danets");
    expect(reportEmailHtml(data, null, { name: "Danets", color: "#1d4ed8", poweredBy: true })).toContain("Made with Danets");
  });

  it("names the file and recognises logo formats", () => {
    expect(reportFileName("Acme <Plumbing>", "2026-10")).toBe("acme-plumbing-seo-report-2026-10.pdf");
    expect(imageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(imageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(imageFormat(Buffer.from("<svg>"))).toBeNull();
  });

  it("renders the PDF in the white-label brand", async () => {
    const buf = await renderReportPdf({
      data,
      nextSteps: { summary: "A good month.", steps: [{ title: "One", detail: "x" }, { title: "Two", detail: "y" }, { title: "Three", detail: "z" }] },
      brand: { name: "Agency Co", color: "#ff0000", poweredBy: false, logo: null, logoUrl: null, whiteLabel: true },
    });
    const text = buf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    // The document's author and producer are the agency, not Danets.
    expect(text).toContain("(Agency Co)");
    expect(text).not.toContain("Danets");
  });
});
