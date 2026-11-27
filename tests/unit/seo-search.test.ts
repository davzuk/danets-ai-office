import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const {
  addDaysIso,
  addMonthsIso,
  aggregateByKey,
  backfillStart,
  buildMetrics,
  countLeadsByPage,
  endOfMonthIso,
  lastFinalDay,
  monthWindows,
  normalizePage,
  sumMetrics,
  toDimensionRows,
  toIso,
  toTotalRows,
  topPerDay,
  windowsFor,
} = await import("@/lib/seo/search");

describe("search dates", () => {
  it("adds and month-aligned dates without shifting off the day", () => {
    expect(addDaysIso("2026-11-24", 1)).toBe("2026-11-25");
    expect(addDaysIso("2026-11-24", -3)).toBe("2026-11-21");
    expect(endOfMonthIso("2026-02-10")).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-24", -16)).toBe("2025-07-24");
    // End-of-month edges clamp instead of overflowing into the next month.
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("treats today as the day three days ago (final data lag)", () => {
    expect(toIso(new Date("2026-11-27T23:59:00Z"))).toBe("2026-11-27");
    expect(lastFinalDay(new Date("2026-11-27T23:59:00Z"))).toBe("2026-11-24");
    expect(backfillStart("2026-11-24")).toBe("2025-07-24");
  });
});

describe("sync windows", () => {
  it("chunks a range into contiguous calendar months", () => {
    const windows = monthWindows("2025-07-24", "2026-11-24");
    expect(windows).toHaveLength(17);
    expect(windows[0]).toEqual({ from: "2025-07-24", to: "2025-07-31" });
    expect(windows.at(-1)).toEqual({ from: "2026-11-01", to: "2026-11-24" });
    for (let i = 1; i < windows.length; i++) {
      expect(addDaysIso(windows[i - 1].to, 1)).toBe(windows[i].from);
    }
  });

  it("returns no windows once syncedThrough reaches the last final day", () => {
    const now = new Date("2026-11-27T23:59:00Z");
    expect(windowsFor(null, now)).toHaveLength(17); // full 16-month backfill
    expect(windowsFor(null, now)[0].from).toBe("2025-07-24");
    expect(windowsFor("2026-11-20", now)).toEqual([{ from: "2026-11-21", to: "2026-11-24" }]);
    expect(windowsFor("2026-11-24", now)).toEqual([]);
  });
});

describe("row mapping", () => {
  it("maps totals and two-key dimension rows", () => {
    expect(toTotalRows([{ keys: ["2026-11-01"], clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 }])).toEqual([
      { date: "2026-11-01", kind: "total", key: "", clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 },
    ]);
    expect(toDimensionRows([{ keys: ["garage roof repair", "2026-11-01"], clicks: 2, impressions: 40, ctr: 0.05, position: 6 }, { keys: ["DESKTOP", "2026-11-01"], clicks: 9, impressions: 90, ctr: 0.1, position: 3 }], "query")).toEqual([
      { date: "2026-11-01", kind: "query", key: "garage roof repair", clicks: 2, impressions: 40, ctr: 0.05, position: 6 },
      { date: "2026-11-01", kind: "query", key: "DESKTOP", clicks: 9, impressions: 90, ctr: 0.1, position: 3 },
    ]);
  });

  it("keeps the most-seen rows per day", () => {
    const rows = [
      { date: "2026-11-01", kind: "query", key: "a", clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
      { date: "2026-11-01", kind: "query", key: "b", clicks: 1, impressions: 20, ctr: 0.05, position: 2 },
      { date: "2026-11-02", kind: "query", key: "c", clicks: 1, impressions: 30, ctr: 0.03, position: 3 },
    ] as const;
    expect(topPerDay(rows as never, 1).map((r) => r.key)).toEqual(["b", "c"]);
  });

  it("flattens one window's Google responses into a report of slices", () => {
    const metric = buildMetrics({
      dayRows: [{ keys: ["2026-11-01"], clicks: 5, impressions: 100, ctr: 0.05, position: 4 }],
      queryRows: [{ keys: ["roof repair", "2026-11-01"], clicks: 2, impressions: 50, ctr: 0.04, position: 5 }],
      pageRows: [{ keys: ["https://acme.test/", "2026-11-01"], clicks: 3, impressions: 60, ctr: 0.05, position: 6 }],
      deviceRows: [{ keys: ["MOBILE", "2026-11-01"], clicks: 4, impressions: 70, ctr: 0.057, position: 7 }],
      countryRows: [{ keys: ["GBR", "2026-11-01"], clicks: 1, impressions: 10, ctr: 0.1, position: 8 }],
    });
    expect(metric).toEqual([
      { date: "2026-11-01", kind: "total", key: "", clicks: 5, impressions: 100, ctr: 0.05, position: 4 },
      { date: "2026-11-01", kind: "query", key: "roof repair", clicks: 2, impressions: 50, ctr: 0.04, position: 5 },
      { date: "2026-11-01", kind: "page", key: "https://acme.test/", clicks: 3, impressions: 60, ctr: 0.05, position: 6 },
      { date: "2026-11-01", kind: "device", key: "MOBILE", clicks: 4, impressions: 70, ctr: 0.057, position: 7 },
      { date: "2026-11-01", kind: "country", key: "GBR", clicks: 1, impressions: 10, ctr: 0.1, position: 8 },
    ]);
  });
});

describe("aggregation", () => {
  it("recomputes CTR and the impression-weighted average position", () => {
    const totals = sumMetrics([
      { clicks: 2, impressions: 100, position: 5 },
      { clicks: 3, impressions: 200, position: 2 },
    ]);
    expect(totals.clicks).toBe(5);
    expect(totals.impressions).toBe(300);
    expect(totals.ctr).toBeCloseTo(5 / 300);
    expect(totals.position).toBeCloseTo((100 * 5 + 200 * 2) / 300);
    expect(sumMetrics([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  it("groups by key and sorts by impressions", () => {
    const rows = [
      { key: "a", clicks: 1, impressions: 10, position: 1 },
      { key: "b", clicks: 1, impressions: 50, position: 2 },
      { key: "a", clicks: 1, impressions: 10, position: 3 },
    ];
    expect(aggregateByKey(rows).map((r) => [r.key, r.impressions])).toEqual([
      ["b", 50],
      ["a", 20],
    ]);
  });
});

describe("page normalisation", () => {
  it("matches Search Console page URLs to Touchpoint landing URLs", () => {
    expect(normalizePage("https://Example.com/Offers?utm_source=google#x")).toBe("https://example.com/offers");
    expect(normalizePage("https://example.com/offers/")).toBe("https://example.com/offers");
    expect(normalizePage("https://example.com/")).toBe("https://example.com");
    expect(normalizePage("not a url")).toBeNull();
    expect(normalizePage(null)).toBeNull();
  });
});
describe("leads from search", () => {
  it("counts distinct contacts per landing page, ignoring anonymous visits", () => {
    const leads = countLeadsByPage([
      { landingUrl: "https://acme.test/services", contactId: "c1" },
      { landingUrl: "https://ACME.test/services/?utm_source=google", contactId: "c1" },
      { landingUrl: "https://acme.test/services", contactId: "c2" },
      { landingUrl: "https://acme.test/services", contactId: null },
      { landingUrl: "https://acme.test/about", contactId: "c1" },
      { landingUrl: null, contactId: "c3" },
    ]);
    expect(Object.fromEntries(leads)).toEqual({ "https://acme.test/services": 2, "https://acme.test/about": 1 });
  });
});
