import { describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({
  opps: [] as Record<string, unknown>[],
  keywords: [] as Record<string, unknown>[],
  property: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => {
  let n = 0;
  const db: Record<string, unknown> = {
    searchProperty: {
      findUnique: async () => mem.property,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(mem.property!, data),
    },
    trackedKeyword: {
      findMany: async () => mem.keywords.map((k) => ({ id: k.id, keyword: k.keyword })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(mem.keywords.find((k) => k.id === where.id)!, data),
    },
    seoOpportunity: {
      findMany: async () => mem.opps.map((o) => ({ id: o.id, kind: o.kind, query: o.query, page: o.page })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(mem.opps.find((o) => o.id === where.id)!, data),
      create: async ({ data }: { data: Record<string, unknown> }) => mem.opps.push({ id: `new${++n}`, dismissedAt: null, ...data }),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        mem.opps = mem.opps.filter((o) => !where.id.in.includes(o.id as string));
      },
    },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db };
});
vi.mock("@/lib/seo/google", () => ({ googleJobError: () => "err", searchAnalyticsQuery: async () => [] }));
vi.mock("@/lib/module-access", () => ({ isModuleEnabled: async () => true }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/plan-quota", () => ({ getEffectiveLimits: async () => ({ trackedKeywordLimit: 50 }) }));
vi.mock("@/lib/llm", () => ({ aiStructured: vi.fn(), logUsage: async () => {}, AiRefusalError: class extends Error {} }));
vi.mock("@/lib/content/platforms", () => ({ findBannedPhrases: () => [] }));
vi.mock("@/lib/content/context", () => ({ loadContentContext: async () => ({ businessName: "Acme", brandContext: "", dontPhrases: [], facts: [] }) }));
vi.mock("@/lib/seo/audit", () => ({ pageSuggestions: async () => "" }));

import { expectedCtr, findOpportunities, pageKey, scanProperty, type PairRow } from "@/lib/seo/opportunities";
import { keywordStats, normalizeKeyword, parseKeywordList } from "@/lib/seo/keywords";
import { checkBrief, queryCluster, questionQueries, type BriefData } from "@/lib/seo/briefs";

const row = (query: string, page: string, impressions: number, clicks: number, position: number): PairRow => ({ query, page, impressions, clicks, position });

describe("findOpportunities on a fixture", () => {
  // Hand-computed (28 days, potential scaled by 30/28):
  //  boiler repair:   pos 12, 200 imp, CTR 1%  -> almost page one, 200*(0.05-0.01)=8 -> 8.57 -> 9
  //  plumber leeds:   /a and /a#faq merge -> 400 imp, 4 clicks, pos 2; 1% < 15%/2 -> low CTR, 400*(0.15-0.01)=56 -> 60
  //  drain unblocking: /x 60 imp (10% CTR) + /y 40 imp -> pos 5.4, competing; 100*0.1-7=3 -> 3.21 -> 3
  //  tiny: 10 impressions -> nothing
  const rows = [
    row("boiler repair", "https://acme.test/boiler", 200, 2, 12),
    row("plumber leeds", "https://acme.test/a", 300, 3, 2),
    row("plumber leeds", "https://acme.test/a#faq", 100, 1, 2),
    row("drain unblocking", "https://acme.test/x", 60, 6, 3),
    row("drain unblocking", "https://acme.test/y", 40, 1, 9),
    row("tiny", "https://acme.test/t", 10, 0, 15),
  ];

  it("matches the hand-computed list", () => {
    const got = findOpportunities(rows, 28).map((o) => ({ kind: o.kind, query: o.query, page: o.page, potential: o.potentialClicks, position: o.position }));
    expect(got).toEqual([
      { kind: "almost_page_one", query: "boiler repair", page: "https://acme.test/boiler", potential: 9, position: 12 },
      { kind: "low_ctr", query: "plumber leeds", page: "https://acme.test/a", potential: 60, position: 2 },
      { kind: "cannibalisation", query: "drain unblocking", page: "https://acme.test/x", potential: 3, position: 5.4 },
    ]);
    const c = findOpportunities(rows, 28).find((o) => o.kind === "cannibalisation")!;
    expect(c.pages!.map((p) => p.url)).toEqual(["https://acme.test/x", "https://acme.test/y"]);
  });

  it("expectedCtr and pageKey", () => {
    expect(expectedCtr(1)).toBe(0.28);
    expect(expectedCtr(5.4)).toBe(0.05);
    expect(expectedCtr(15)).toBe(0.01);
    expect(expectedCtr(40)).toBe(0.005);
    expect(expectedCtr(0)).toBe(0);
    expect(pageKey("https://a.test/p#x")).toBe("https://a.test/p");
  });
});

describe("keywords", () => {
  it("normalises and parses lists", () => {
    expect(normalizeKeyword("  Boiler   REPAIR ")).toBe("boiler repair");
    expect(normalizeKeyword("   ")).toBeNull();
    expect(parseKeywordList("a one, b two\nA ONE").keywords).toEqual(["a one", "b two"]);
  });

  it("works out position, change and the weekly series", () => {
    const s = keywordStats(
      [
        { date: "2026-11-10", key: "k", clicks: 5, impressions: 100, position: 4 },
        { date: "2026-10-15", key: "k", clicks: 1, impressions: 100, position: 6 },
      ],
      "2026-11-20"
    );
    expect(s).toMatchObject({ clicks: 5, impressions: 100, position: 4, previousPosition: 6, change: 2 });
    expect(s.weekly).toHaveLength(12);
    expect(s.weekly[11]).toBeNull();
    expect(s.weekly[10]).toBe(4);
    expect(keywordStats([], "2026-11-20").position).toBeNull();
  });
});

describe("scanProperty", () => {
  it("keeps dismissals, replaces stale rows and records ranking pages", async () => {
    mem.property = { id: "p1", businessId: "b1", connectionId: "c1", siteUrl: "https://acme.test/", status: "active" };
    mem.keywords = [{ id: "k1", keyword: "boiler repair", rankingPage: null }];
    const dismissed = new Date("2026-11-01");
    mem.opps = [
      { id: "o1", kind: "almost_page_one", query: "boiler repair", page: "https://acme.test/boiler", dismissedAt: dismissed, suggestion: null },
      { id: "o2", kind: "low_ctr", query: "gone search", page: "https://acme.test/g", dismissedAt: null, suggestion: "x" },
    ];
    const now = new Date("2026-11-23T08:00:00Z");
    const r = await scanProperty("p1", { now, fetchRows: async () => [row("boiler repair", "https://acme.test/boiler", 200, 2, 12)] });
    expect(r).toEqual({ opportunities: 1 });
    expect(mem.opps.map((o) => o.id)).toEqual(["o1"]);
    expect(mem.opps[0].dismissedAt).toBe(dismissed);
    expect(mem.opps[0].potentialClicks).toBe(9);
    expect(mem.keywords[0].rankingPage).toBe("https://acme.test/boiler");
    expect(mem.property!.opportunitiesAt).toBe(now);
  });
});

describe("briefs", () => {
  it("clusters related searches and picks questions", () => {
    const c = queryCluster("boiler repair leeds", [
      { key: "boiler repair cost", impressions: 50 },
      { key: "how much is boiler repair", impressions: 80 },
      { key: "garden design", impressions: 500 },
    ]);
    expect(c).toEqual(["how much is boiler repair", "boiler repair cost"]);
    expect(questionQueries(c)).toEqual(["how much is boiler repair"]);
  });

  it("keeps only knowledge-base facts and marks the gaps", () => {
    const data: BriefData = {
      intent: "Find a boiler engineer",
      intentType: "local",
      title: "Boiler repair",
      metaDescription: "Fast repairs. [Add your call-out fee]",
      h1: "Boiler repair",
      wordCount: 50,
      outline: [{ heading: "Prices", points: ["[Add your hourly rate]"] }],
      questions: [],
      facts: [
        { fact: "Gas Safe registered", source: "About us" },
        { fact: "Made up award", source: "Nowhere" },
      ],
      gaps: ["a customer quote"],
    };
    const { brief, dropped } = checkBrief(data, ["About us"]);
    expect(brief.facts).toEqual([{ fact: "Gas Safe registered", source: "About us" }]);
    expect(dropped).toEqual(["Made up award"]);
    expect(brief.gaps).toEqual(["[Add your call-out fee]", "[Add your hourly rate]", "[Add a customer quote]"]);
    expect(brief.wordCount).toBe(300);
  });
});
