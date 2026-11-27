// Site audit rules (W). Pure: what counts as an issue on a page or across
// the site, how bad it is, and the score. One table of issue definitions so
// the UI, the score and the tests agree.

import type { PageFacts } from "./html";

export type Severity = "critical" | "warning" | "notice";

export interface IssueDef {
  severity: Severity;
  label: string;
  /** Why it matters and what to do, shown to the tenant. */
  help: string;
  /** Score points per occurrence. */
  weight: number;
  /** Most points one code can take off, so one repeated issue can't zero the score. */
  cap: number;
  /** "Suggest a fix" is offered (AI writes copy the tenant can paste). */
  aiFix?: boolean;
}

export const ISSUE_DEFS = {
  page_error: { severity: "critical", label: "Page returns an error", help: "Visitors and Google get an error instead of the page. Fix the page or remove links to it.", weight: 5, cap: 25 },
  broken_link: { severity: "critical", label: "Broken link", help: "A link points at a page that doesn't exist or errors. Update or remove the link.", weight: 2, cap: 15 },
  no_https: { severity: "critical", label: "Site isn't served over HTTPS", help: "Browsers mark the site as not secure. Turn on HTTPS and redirect http to https.", weight: 15, cap: 15 },
  noindex: { severity: "critical", label: "Page is hidden from Google", help: "A noindex tag tells Google not to list this page. Remove it unless the page should stay out of search.", weight: 4, cap: 15 },
  missing_title: { severity: "critical", label: "Missing page title", help: "The title is the blue link in Google results. Give every page a unique title.", weight: 4, cap: 15, aiFix: true },
  mixed_content: { severity: "warning", label: "Insecure content on a secure page", help: "The page loads images, scripts or styles over http. Switch them to https.", weight: 2, cap: 10 },
  duplicate_title: { severity: "warning", label: "Duplicate page title", help: "Several pages share this title, so Google can't tell them apart. Make each title unique.", weight: 1, cap: 8, aiFix: true },
  title_too_long: { severity: "warning", label: "Title too long", help: "Google cuts titles longer than about 60 characters. Put the important words first.", weight: 1, cap: 5, aiFix: true },
  title_too_short: { severity: "notice", label: "Title too short", help: "A very short title wastes space in search results. Say what the page offers.", weight: 0.5, cap: 3, aiFix: true },
  missing_meta_description: { severity: "warning", label: "Missing meta description", help: "Google often shows the description under the title. Write one that makes people click.", weight: 1, cap: 8, aiFix: true },
  meta_description_too_long: { severity: "notice", label: "Meta description too long", help: "Descriptions over about 160 characters are cut off.", weight: 0.5, cap: 3, aiFix: true },
  duplicate_meta_description: { severity: "notice", label: "Duplicate meta description", help: "Several pages share this description. Write one per page.", weight: 0.5, cap: 4, aiFix: true },
  missing_h1: { severity: "warning", label: "Missing main heading (H1)", help: "Every page should have one main heading saying what it's about.", weight: 1, cap: 6, aiFix: true },
  multiple_h1: { severity: "notice", label: "More than one main heading (H1)", help: "Use one H1 per page and H2s for sections.", weight: 0.5, cap: 3, aiFix: true },
  missing_alt: { severity: "warning", label: "Images without alt text", help: "Alt text describes images to screen readers and Google Images.", weight: 0.5, cap: 6, aiFix: true },
  redirect_chain: { severity: "warning", label: "Redirect chain", help: "A link goes through several redirects before reaching the page. Link straight to the final address.", weight: 1, cap: 5 },
  slow_lcp: { severity: "warning", label: "Slow main content (LCP)", help: "The largest content on the page appears slowly. Compress images and reduce render-blocking code.", weight: 3, cap: 9 },
  slow_inp: { severity: "warning", label: "Slow to respond to taps (INP)", help: "The page reacts slowly to taps and clicks. Reduce heavy JavaScript.", weight: 3, cap: 9 },
  high_cls: { severity: "warning", label: "Layout shifts while loading (CLS)", help: "Content jumps around as the page loads. Give images and embeds fixed sizes.", weight: 3, cap: 9 },
  missing_canonical: { severity: "notice", label: "No canonical link", help: "A canonical link tells Google which address is the main one when a page has several.", weight: 0.25, cap: 3 },
  missing_viewport: { severity: "warning", label: "Not set up for mobile", help: "There's no viewport tag, so phones show the desktop layout.", weight: 2, cap: 6 },
  missing_lang: { severity: "notice", label: "Page language not set", help: "Add a lang attribute to the html tag.", weight: 0.25, cap: 2 },
  missing_structured_data: { severity: "notice", label: "No structured data", help: "Structured data (schema.org) helps Google show rich results such as your opening hours and reviews.", weight: 1, cap: 1 },
  thin_content: { severity: "notice", label: "Very little text", help: "Pages with little text rarely rank. Explain the offer in more depth.", weight: 0.5, cap: 4 },
} as const satisfies Record<string, IssueDef>;

export type IssueCode = keyof typeof ISSUE_DEFS;

export interface Issue {
  pageUrl: string;
  code: IssueCode;
  detail?: Record<string, unknown>;
}

export const TITLE_MAX = 60;
export const TITLE_MIN = 15;
export const DESCRIPTION_MAX = 160;
export const THIN_WORDS = 250;

/** Issues visible on one successfully fetched HTML page. */
export function pageIssues(pageUrl: string, facts: PageFacts, opts: { isHome: boolean }): Issue[] {
  const out: Issue[] = [];
  const add = (code: IssueCode, detail?: Record<string, unknown>) => out.push({ pageUrl, code, ...(detail ? { detail } : {}) });

  const robots = facts.metaRobots ?? "";
  const noindex = /\b(noindex|none)\b/.test(robots);
  if (noindex) add("noindex", { robots });

  if (!facts.title) add("missing_title");
  else if (facts.title.length > TITLE_MAX) add("title_too_long", { current: facts.title, length: facts.title.length });
  else if (facts.title.length < TITLE_MIN) add("title_too_short", { current: facts.title, length: facts.title.length });

  if (!facts.metaDescription) add("missing_meta_description");
  else if (facts.metaDescription.length > DESCRIPTION_MAX) add("meta_description_too_long", { current: facts.metaDescription, length: facts.metaDescription.length });

  const h1 = facts.h1.filter(Boolean);
  if (h1.length === 0) add("missing_h1");
  else if (h1.length > 1) add("multiple_h1", { headings: h1.slice(0, 5) });

  const noAlt = facts.images.filter((i) => i.alt === null);
  if (noAlt.length) add("missing_alt", { count: noAlt.length, images: noAlt.slice(0, 5).map((i) => i.src) });

  if (facts.mixedContent.length) add("mixed_content", { count: facts.mixedContent.length, urls: facts.mixedContent.slice(0, 5) });
  if (!facts.canonical) add("missing_canonical");
  if (!facts.hasViewport) add("missing_viewport");
  if (!facts.lang) add("missing_lang");
  if (opts.isHome && facts.jsonLdCount === 0) add("missing_structured_data");
  // Noindexed pages aren't meant to rank, so thin text there isn't a problem.
  if (!noindex && facts.wordCount < THIN_WORDS) add("thin_content", { words: facts.wordCount });
  return out;
}

export interface CrawledPage {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  noindex: boolean;
}

/** Pages sharing a title or description (only indexable, successful pages). */
export function duplicateIssues(pages: CrawledPage[]): Issue[] {
  const out: Issue[] = [];
  const ok = pages.filter((p) => p.status >= 200 && p.status < 300 && !p.noindex);
  for (const [field, code] of [
    ["title", "duplicate_title"],
    ["description", "duplicate_meta_description"],
  ] as const) {
    const groups = new Map<string, string[]>();
    for (const p of ok) {
      const v = p[field]?.trim().toLowerCase();
      if (!v) continue;
      groups.set(v, [...(groups.get(v) ?? []), p.url]);
    }
    for (const urls of groups.values()) {
      if (urls.length < 2) continue;
      const current = ok.find((p) => p.url === urls[0])?.[field] ?? "";
      for (const url of urls) out.push({ pageUrl: url, code, detail: { current, pages: urls.filter((u) => u !== url).slice(0, 5), count: urls.length } });
    }
  }
  return out;
}

export interface LinkCheck {
  /** The page the link was found on. */
  from: string;
  link: string;
  status: number;
  /** Redirect hops before the final answer. */
  hops: number;
  internal: boolean;
}

export function linkIssues(checks: LinkCheck[]): Issue[] {
  const out: Issue[] = [];
  for (const c of checks) {
    // 0 = no answer at all (DNS failure, refused, timed out).
    if (c.status === 0 || c.status >= 400) out.push({ pageUrl: c.from, code: "broken_link", detail: { link: c.link, status: c.status, internal: c.internal } });
    else if (c.internal && c.hops >= 2) out.push({ pageUrl: c.from, code: "redirect_chain", detail: { link: c.link, hops: c.hops } });
  }
  return out;
}

// ─── Core Web Vitals ─────────────────────────────────────────────────

export interface Vitals {
  url: string;
  /** "field" = real-user (CrUX) data; "lab" = a Lighthouse run. */
  source: "field" | "lab";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  performance: number | null;
}

export const VITAL_THRESHOLDS = {
  lcpMs: { good: 2500, poor: 4000 },
  inpMs: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const;

export type VitalRating = "good" | "needs_improvement" | "poor";

export function rateVital(metric: keyof typeof VITAL_THRESHOLDS, value: number | null): VitalRating | null {
  if (value === null || !Number.isFinite(value)) return null;
  const t = VITAL_THRESHOLDS[metric];
  return value <= t.good ? "good" : value <= t.poor ? "needs_improvement" : "poor";
}

type Psi = {
  loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
  lighthouseResult?: { categories?: { performance?: { score?: number | null } }; audits?: Record<string, { numericValue?: number }> };
};

/** Read a PageSpeed Insights v5 response: field data when Google has enough, else lab. */
export function vitalsFromPsi(url: string, raw: unknown): Vitals {
  const psi = (raw ?? {}) as Psi;
  const field = psi.loadingExperience?.metrics ?? {};
  const audits = psi.lighthouseResult?.audits ?? {};
  const perf = psi.lighthouseResult?.categories?.performance?.score;
  const performance = typeof perf === "number" ? Math.round(perf * 100) : null;
  const f = (k: string) => (typeof field[k]?.percentile === "number" ? field[k].percentile! : null);
  const fLcp = f("LARGEST_CONTENTFUL_PAINT_MS");
  const fInp = f("INTERACTION_TO_NEXT_PAINT");
  const fCls = f("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  if (fLcp !== null || fInp !== null || fCls !== null) {
    return { url, source: "field", lcpMs: fLcp, inpMs: fInp, cls: fCls === null ? null : fCls / 100, performance };
  }
  const lab = (k: string) => (typeof audits[k]?.numericValue === "number" ? audits[k].numericValue! : null);
  const lcp = lab("largest-contentful-paint");
  const cls = lab("cumulative-layout-shift");
  // The lab run has no INP (it needs real taps).
  return { url, source: "lab", lcpMs: lcp === null ? null : Math.round(lcp), inpMs: null, cls: cls === null ? null : Math.round(cls * 1000) / 1000, performance };
}

export function vitalsIssues(v: Vitals): Issue[] {
  const out: Issue[] = [];
  const check = (metric: keyof typeof VITAL_THRESHOLDS, code: IssueCode, value: number | null) => {
    const rating = rateVital(metric, value);
    if (rating && rating !== "good") out.push({ pageUrl: v.url, code, detail: { value, rating, source: v.source } });
  };
  check("lcpMs", "slow_lcp", v.lcpMs);
  check("inpMs", "slow_inp", v.inpMs);
  check("cls", "high_cls", v.cls);
  return out;
}

// ─── Score and summary ───────────────────────────────────────────────

/** 100 minus weighted issue counts, each code capped. Poor vitals count double. */
export function scoreFor(issues: Pick<Issue, "code" | "detail">[]): number {
  const lost = new Map<IssueCode, number>();
  for (const i of issues) {
    const def = ISSUE_DEFS[i.code];
    const factor = i.detail?.rating === "poor" ? 2 : 1;
    lost.set(i.code, (lost.get(i.code) ?? 0) + def.weight * factor);
  }
  let total = 0;
  for (const [code, pts] of lost) total += Math.min(pts, ISSUE_DEFS[code].cap);
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

export interface AuditSummary {
  critical: number;
  warning: number;
  notice: number;
  byCode: Partial<Record<IssueCode, number>>;
}

export function summarize(issues: Pick<Issue, "code">[]): AuditSummary {
  const s: AuditSummary = { critical: 0, warning: 0, notice: 0, byCode: {} };
  for (const i of issues) {
    s[ISSUE_DEFS[i.code].severity]++;
    s.byCode[i.code] = (s.byCode[i.code] ?? 0) + 1;
  }
  return s;
}

/** Identity of an issue across audits, for "new" and "fixed". */
export function issueKey(i: { code: string; pageUrl: string; detail?: unknown }): string {
  const d = (i.detail ?? {}) as { link?: string };
  return `${i.code}|${i.pageUrl}|${d.link ?? ""}`;
}

export function isIssueCode(code: string): code is IssueCode {
  return Object.prototype.hasOwnProperty.call(ISSUE_DEFS, code);
}
