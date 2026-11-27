import "server-only";
// Site audit (Phase 3, workstream W): crawl a tenant's own website, find what
// hurts it in search, score it, and suggest fixes. Danets never edits the
// site; it reports and suggests.
//
// The crawl runs as a chain of `seo.audit` jobs. Each run works for a time
// budget, checkpoints every 25 pages (crawl state + the issues found so far,
// in one transaction) and queues the next run, so no single job runs long
// and a killed worker resumes from the last checkpoint.

import type { AuditIssue, SiteAudit } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification, logActivity } from "@/lib/activity";
import { logger, serializeError } from "@/lib/logger";
import { getEffectiveLimits } from "@/lib/plan-quota";
import { aiStructured, logUsage, AiRefusalError } from "@/lib/llm";
import { getBrandContext } from "@/lib/brand";
import { siteOrigin } from "@/lib/sites/host";
import { AUDIT_BOT_TOKEN, checkUrl, FetchBlockedError, isHtml, safeFetch, type AllowPrivate, type LookupFn, type SafeFetchOptions } from "./fetch";
import { parseRobots, parseSitemap, robotsPolicy, type RobotsPolicy } from "./robots";
import { parsePage } from "./html";
import {
  duplicateIssues,
  ISSUE_DEFS,
  isIssueCode,
  issueKey,
  linkIssues,
  pageIssues,
  scoreFor,
  summarize,
  vitalsFromPsi,
  vitalsIssues,
  type CrawledPage,
  type Issue,
  type IssueCode,
  type LinkCheck,
  type Vitals,
} from "./audit-rules";

export interface Actor {
  businessId: string;
  userId?: string;
  name: string;
}

const log = (a: Actor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.userId, userName: a.name, action, module: "seo", description, metadata });

/** Hard ceiling when the plan says "unlimited" (0). */
export const MAX_AUDIT_PAGES = 5000;
export const CHECKPOINT_EVERY = 25;
export const MAX_LINK_CHECKS = 200;
export const MAX_DEPTH = 10;
export const MANUAL_GAP_MS = 60 * 60_000;
export const MONTHLY_GAP_MS = 30 * 24 * 60 * 60_000;
export const KEEP_AUDITS = 12;
const DEFAULT_DELAY_MS = 250;
const MAX_DELAY_MS = 10_000;
const MAX_SITEMAP_FILES = 5;

// ─── Which sites a tenant owns ───────────────────────────────────────

export interface OwnedSites {
  /** Exact hostnames (widget origins, URL-prefix properties, the platform-built site). */
  hosts: string[];
  /** Registrable domains from domain properties: the domain and every subdomain. */
  domains: string[];
}

export interface SiteCandidate {
  url: string;
  source: "search_console" | "widget" | "platform_site";
}

const bareHost = (h: string) => h.toLowerCase().replace(/\.$/, "");
const twin = (h: string) => (h.startsWith("www.") ? h.slice(4) : `www.${h}`);

export function isOwnedHost(host: string, owned: OwnedSites): boolean {
  const h = bareHost(host);
  if (owned.hosts.some((o) => o === h || twin(o) === h)) return true;
  return owned.domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Owned sites from a tenant's records. Pure, so it can be tested. */
export function ownedFrom(input: { propertyUrls: string[]; widgetOrigins: unknown; platformOrigin: string | null }): { owned: OwnedSites; candidates: SiteCandidate[] } {
  const owned: OwnedSites = { hosts: [], domains: [] };
  const candidates: SiteCandidate[] = [];
  const addCandidate = (url: string, source: SiteCandidate["source"]) => {
    if (!candidates.some((c) => c.url === url)) candidates.push({ url, source });
  };
  for (const p of input.propertyUrls) {
    if (p.startsWith("sc-domain:")) {
      const d = bareHost(p.slice("sc-domain:".length));
      if (!d) continue;
      owned.domains.push(d);
      addCandidate(`https://${d}/`, "search_console");
    } else {
      try {
        const u = new URL(p);
        owned.hosts.push(bareHost(u.hostname));
        addCandidate(u.href, "search_console");
      } catch {
        /* ignore */
      }
    }
  }
  for (const o of Array.isArray(input.widgetOrigins) ? input.widgetOrigins : []) {
    if (typeof o !== "string") continue;
    try {
      const u = new URL(o);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      owned.hosts.push(bareHost(u.hostname));
      addCandidate(`${u.origin}/`, "widget");
    } catch {
      /* ignore */
    }
  }
  if (input.platformOrigin) {
    try {
      const u = new URL(input.platformOrigin);
      owned.hosts.push(bareHost(u.hostname));
      addCandidate(`${u.origin}/`, "platform_site");
    } catch {
      /* ignore */
    }
  }
  return { owned, candidates };
}

export async function ownedSites(businessId: string) {
  const [props, business, site] = await Promise.all([
    db.searchProperty.findMany({ where: { businessId }, select: { siteUrl: true }, orderBy: { createdAt: "asc" } }),
    db.business.findUnique({ where: { id: businessId }, select: { widgetAllowedOrigins: true } }),
    db.tenantSite.findUnique({ where: { businessId }, select: { subdomain: true, status: true } }),
  ]);
  return ownedFrom({
    propertyUrls: props.map((p) => p.siteUrl),
    widgetOrigins: business?.widgetAllowedOrigins ?? [],
    platformOrigin: site && site.status === "active" ? siteOrigin(site.subdomain) : null,
  });
}

/** Normalise a site address the tenant typed: add https://, keep only the origin and path. */
export function normalizeSiteInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.search = "";
    return u.href;
  } catch {
    return null;
  }
}

// ─── Crawl URLs ────────────────────────────────────────────────────────

const TRACKING_PARAM = /^(utm_[a-z_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|yclid)$/i;
const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|rar|7z|gz|tgz|mp4|m4v|mp3|wav|ogg|webm|mov|avi|docx?|xlsx?|pptx?|csv|txt|xml|json|css|js|mjs|woff2?|ttf|otf|eot|apk|exe|dmg)$/i;

export function normalizeCrawlUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    u.hostname = bareHost(u.hostname);
    return u.href;
  } catch {
    return null;
  }
}

export const looksLikePage = (url: string) => !NON_HTML.test(new URL(url).pathname);

// ─── Crawl state ──────────────────────────────────────────────────────

interface LinkTarget {
  url: string;
  internal: boolean;
}

export interface CrawlState {
  v: 1;
  root: string;
  /** Host the crawl stays on (the root's, after redirects). */
  host: string;
  phase: "crawl" | "links" | "vitals" | "finish";
  queue: [string, number][];
  seen: string[];
  pages: (CrawledPage & { hops: number })[];
  /** Up to 3 pages linking to each target, for reporting where a broken link lives. */
  refs: Record<string, string[]>;
  /** Links checked with HEAD/GET instead of crawled (other sites, files). */
  linkQueue: LinkTarget[];
  linkResults: Record<string, { status: number; hops: number; internal: boolean }>;
  robots: string | null;
  robotsBlocked: number;
  notes: string[];
  runs: number;
}

// Fast membership tests over the state's arrays (which stay arrays so the
// checkpoint is plain JSON).
const seenSets = new WeakMap<CrawlState, Set<string>>();
const linkSets = new WeakMap<CrawlState, Set<string>>();

/** Mark a page URL seen; false if it already was. */
function markSeen(state: CrawlState, url: string): boolean {
  let set = seenSets.get(state);
  if (!set) seenSets.set(state, (set = new Set(state.seen)));
  if (set.has(url)) return false;
  set.add(url);
  state.seen.push(url);
  return true;
}

/** Queue a link for checking unless it's queued or checked already. */
function queueLink(state: CrawlState, target: LinkTarget) {
  let set = linkSets.get(state);
  if (!set) linkSets.set(state, (set = new Set([...state.linkQueue.map((l) => l.url), ...Object.keys(state.linkResults)])));
  if (set.has(target.url)) return;
  set.add(target.url);
  state.linkQueue.push(target);
}

function addRef(state: CrawlState, target: string, from: string) {
  const r = (state.refs[target] ??= []);
  if (r.length < 3 && !r.includes(from)) r.push(from);
}

export interface RunOptions {
  /** Wall-clock budget for this run before checkpointing and handing over. */
  budgetMs?: number;
  /** Delay between requests to the site (robots.txt Crawl-delay can raise it). */
  delayMs?: number;
  signal?: AbortSignal;
  /** Tests only: fetch from 127.0.0.1 and use a fake DNS. Ignored in production. */
  allowPrivate?: AllowPrivate;
  lookup?: LookupFn;
  /** Tests only: replaces the PageSpeed call. */
  pagespeed?: (url: string) => Promise<unknown>;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

function fetchOpts(opts: RunOptions, extra: SafeFetchOptions = {}): SafeFetchOptions {
  return { allowPrivate: opts.allowPrivate, lookup: opts.lookup, signal: opts.signal, ...extra };
}

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

async function failAudit(audit: SiteAudit, message: string) {
  await db.siteAudit.update({ where: { id: audit.id }, data: { status: "failed", error: message, finishedAt: new Date(), state: Prisma.DbNull } });
  await createNotification({
    businessId: audit.businessId,
    type: "site_audit_done",
    title: "Site audit couldn't finish",
    message: `${audit.rootUrl}: ${message}`,
    data: { auditId: audit.id },
  });
}

export function friendlyFetchError(e: unknown): string {
  if (e instanceof FetchBlockedError) return e.message;
  const code = (e as { code?: string })?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "The site's address couldn't be found.";
  if (code === "ECONNREFUSED") return "The site refused the connection.";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "The site took too long to answer.";
  if (code?.startsWith("ERR_TLS") || code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "The site's security certificate isn't valid.";
  }
  return "The site couldn't be reached.";
}

/** Set up the crawl: resolve the root, read robots.txt and sitemaps. */
async function initState(audit: SiteAudit, owned: OwnedSites, opts: RunOptions): Promise<{ state: CrawlState; issues: Issue[] }> {
  const res = await safeFetch(audit.rootUrl, fetchOpts(opts, { allowRedirect: (next) => isOwnedHost(next.hostname, owned) }));
  if (res.blockedRedirect) throw new AppError(`The site redirects to ${new URL(res.blockedRedirect).hostname}, which isn't one of your sites.`, { status: 422, code: "AUDIT_REDIRECT" });
  const final = new URL(res.url);
  const issues: Issue[] = [];
  if (final.protocol === "http:") issues.push({ pageUrl: final.href, code: "no_https" });

  const state: CrawlState = {
    v: 1,
    root: final.href,
    host: final.host,
    phase: "crawl",
    queue: [],
    seen: [],
    pages: [],
    refs: {},
    linkQueue: [],
    linkResults: {},
    robots: null,
    robotsBlocked: 0,
    notes: [],
    runs: 0,
  };

  try {
    const r = await safeFetch(new URL("/robots.txt", final), fetchOpts(opts, { accept: "text/plain,*/*;q=0.5", maxBytes: 512 * 1024, allowRedirect: (n) => n.host === final.host }));
    if (r.status >= 200 && r.status < 300 && !r.blockedRedirect) state.robots = r.body.slice(0, 500_000);
  } catch {
    /* no robots.txt: everything allowed */
  }
  const policy = robotsPolicy(state.robots ? parseRobots(state.robots) : null, AUDIT_BOT_TOKEN);

  const enqueue = (u: string, depth: number) => {
    const n = normalizeCrawlUrl(u);
    if (!n) return;
    const url = new URL(n);
    if (url.host !== state.host || !looksLikePage(n)) return;
    if (markSeen(state, n)) state.queue.push([n, depth]);
  };
  enqueue(final.href, 0);

  // Sitemaps: robots.txt's, else /sitemap.xml. One level of sitemap index.
  const limit = audit.pageLimit;
  const sitemapFiles = policy.sitemaps.length ? policy.sitemaps : [new URL("/sitemap.xml", final).href];
  const pending = [...sitemapFiles];
  let files = 0;
  while (pending.length && files < MAX_SITEMAP_FILES && state.queue.length < limit * 2) {
    const sm = pending.shift()!;
    files++;
    try {
      const u = new URL(sm, final);
      if (u.host !== state.host) continue;
      const r = await safeFetch(u, fetchOpts(opts, { accept: "application/xml,text/xml,*/*;q=0.5", maxBytes: 5 * 1024 * 1024, allowRedirect: (n) => n.host === final.host }));
      if (r.status < 200 || r.status >= 300) continue;
      const parsed = parseSitemap(r.body);
      pending.push(...parsed.sitemaps);
      for (const loc of parsed.urls) {
        if (state.queue.length >= limit * 2) break;
        enqueue(loc, 1);
      }
    } catch {
      /* a bad sitemap doesn't stop the crawl */
    }
  }
  return { state, issues };
}

interface PageOutcome {
  issues: Issue[];
}

/** Fetch and analyse one page; record it in the state. */
async function crawlPage(state: CrawlState, url: string, depth: number, owned: OwnedSites, opts: RunOptions): Promise<PageOutcome> {
  const issues: Issue[] = [];
  let res;
  try {
    res = await safeFetch(url, fetchOpts(opts, { allowRedirect: (next) => isOwnedHost(next.hostname, owned) }));
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    state.pages.push({ url, status: 0, title: null, description: null, noindex: false, hops: 0 });
    return { issues };
  }
  const finalUrl = normalizeCrawlUrl(res.url) ?? res.url;
  const hops = res.redirects.length;
  const page = { url, status: res.status, title: null as string | null, description: null as string | null, noindex: false, hops };
  state.pages.push(page);
  if (res.blockedRedirect) return { issues };
  // A redirect to another page on the site: crawl the target under its own URL.
  if (finalUrl !== url) {
    const target = new URL(finalUrl);
    if (target.host === state.host && markSeen(state, finalUrl)) {
      state.queue.unshift([finalUrl, depth]);
      addRef(state, finalUrl, url);
    }
    return { issues };
  }
  if (res.status >= 400 || res.status === 0) return { issues };
  if (!isHtml(res.contentType)) return { issues };

  const xRobots = (res.headers["x-robots-tag"] || "").toLowerCase();
  const facts = parsePage(res.body, res.url);
  if (xRobots) facts.metaRobots = [facts.metaRobots, xRobots].filter(Boolean).join(", ");
  page.title = facts.title;
  page.description = facts.metaDescription;
  page.noindex = /\b(noindex|none)\b/.test(facts.metaRobots ?? "");
  issues.push(...pageIssues(url, facts, { isHome: url === state.root }));

  const nofollowPage = /\bnofollow\b/.test(facts.metaRobots ?? "");
  for (const link of facts.links) {
    const n = normalizeCrawlUrl(link.url);
    if (!n) continue;
    const u = new URL(n);
    if (u.host === state.host) {
      if (looksLikePage(n)) {
        addRef(state, n, url);
        if (!nofollowPage && !link.nofollow && depth + 1 <= MAX_DEPTH && markSeen(state, n)) state.queue.push([n, depth + 1]);
      } else {
        addRef(state, n, url);
        queueLink(state, { url: n, internal: true });
      }
    } else {
      addRef(state, n, url);
      queueLink(state, { url: n, internal: false });
    }
  }
  return { issues };
}

/** HEAD a link (GET when HEAD isn't supported). */
async function checkLink(target: LinkTarget, opts: RunOptions): Promise<{ status: number; hops: number }> {
  try {
    let r = await safeFetch(target.url, fetchOpts(opts, { method: "HEAD", timeoutMs: 8000 }));
    if ([403, 405, 501].includes(r.status)) r = await safeFetch(target.url, fetchOpts(opts, { timeoutMs: 8000, maxBytes: 64 * 1024 }));
    return { status: r.status, hops: r.redirects.length };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    // Refused by our own address rules: not the site's fault, so don't report it.
    if (e instanceof FetchBlockedError) return { status: -1, hops: 0 };
    return { status: 0, hops: 0 };
  }
}

async function topPageUrls(businessId: string, host: string, take: number): Promise<string[]> {
  const since = new Date(Date.now() - 28 * 24 * 60 * 60_000);
  const rows = await db.searchMetricDaily.groupBy({
    by: ["key"],
    where: { kind: "page", date: { gte: since }, property: { businessId } },
    _sum: { clicks: true },
    orderBy: { _sum: { clicks: "desc" } },
    take: 50,
  });
  const out: string[] = [];
  for (const r of rows) {
    const n = normalizeCrawlUrl(r.key);
    if (n && new URL(n).host === host && !out.includes(n)) out.push(n);
    if (out.length >= take) break;
  }
  return out;
}

export function pagespeedConfigured(env: NodeJS.ProcessEnv = process.env) {
  return !!env.PAGESPEED_API_KEY;
}

async function runPagespeed(url: string, signal?: AbortSignal): Promise<unknown> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance", key: process.env.PAGESPEED_API_KEY! });
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`PageSpeed answered ${res.status}`);
  return res.json();
}

async function checkpoint(auditId: string, state: CrawlState, issues: Issue[]) {
  await db.$transaction([
    ...(issues.length
      ? [db.auditIssue.createMany({ data: issues.map((i) => ({ auditId, pageUrl: i.pageUrl.slice(0, 1000), code: i.code, severity: ISSUE_DEFS[i.code].severity, detail: i.detail ? asJson(i.detail) : undefined })) })]
      : []),
    db.siteAudit.update({ where: { id: auditId }, data: { state: asJson(state), pagesCrawled: state.pages.length } }),
  ]);
  issues.length = 0;
}

/**
 * Run one slice of an audit. Returns "continue" when there's more to do
 * (the caller queues the next run) and "done" when finished or failed.
 */
export async function runAuditChunk(auditId: string, opts: RunOptions = {}): Promise<"continue" | "done"> {
  const audit = await db.siteAudit.findUnique({ where: { id: auditId } });
  if (!audit || audit.status === "done" || audit.status === "failed") return "done";
  const started = Date.now();
  const budget = opts.budgetMs ?? 4 * 60_000;
  const outOfTime = () => Date.now() - started > budget || !!opts.signal?.aborted;
  const { owned } = await ownedSites(audit.businessId);
  const pending: Issue[] = [];

  let state = audit.state as unknown as CrawlState | null;
  if (!state) {
    if (!isOwnedHost(new URL(audit.rootUrl).hostname, owned)) {
      await failAudit(audit, "This site is no longer linked to your account.");
      return "done";
    }
    await db.siteAudit.update({ where: { id: audit.id }, data: { status: "running", startedAt: audit.startedAt ?? new Date() } });
    try {
      const init = await initState(audit, owned, opts);
      state = init.state;
      pending.push(...init.issues);
    } catch (e) {
      if (opts.signal?.aborted) return "continue";
      await failAudit(audit, e instanceof AppError ? e.message : friendlyFetchError(e));
      return "done";
    }
    await checkpoint(audit.id, state, pending);
  }
  state.runs++;
  const policy: RobotsPolicy = robotsPolicy(state.robots ? parseRobots(state.robots) : null, AUDIT_BOT_TOKEN);
  const delay = Math.min(MAX_DELAY_MS, Math.max(opts.delayMs ?? DEFAULT_DELAY_MS, (policy.crawlDelay ?? 0) * 1000));

  // 1. Crawl pages.
  if (state.phase === "crawl") {
    let sinceCheckpoint = 0;
    let done = 0;
    while (state.queue.length && state.pages.length < audit.pageLimit) {
      // Always make some progress, however small the budget.
      if (done > 0 && outOfTime()) {
        await checkpoint(audit.id, state, pending);
        return "continue";
      }
      const [url, depth] = state.queue.shift()!;
      const u = new URL(url);
      if (!policy.isAllowed(u.pathname + u.search)) {
        state.robotsBlocked++;
        continue;
      }
      if (state.pages.length) await sleep(delay, opts.signal);
      const out = await crawlPage(state, url, depth, owned, opts);
      done++;
      pending.push(...out.issues);
      if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
        await checkpoint(audit.id, state, pending);
        sinceCheckpoint = 0;
      }
    }
    if (state.queue.length) state.notes.push(`Stopped at your plan's limit of ${audit.pageLimit} pages.`);
    if (state.robotsBlocked) state.notes.push(`${state.robotsBlocked} page${state.robotsBlocked === 1 ? " was" : "s were"} skipped because robots.txt blocks crawlers.`);
    state.queue = [];
    state.phase = "links";
    await checkpoint(audit.id, state, pending);
  }

  // 2. Check links to files and other sites.
  if (state.phase === "links") {
    let sinceCheckpoint = 0;
    let done = 0;
    const checked = () => Object.keys(state!.linkResults).length;
    while (state.linkQueue.length && checked() < MAX_LINK_CHECKS) {
      if (done > 0 && outOfTime()) {
        await checkpoint(audit.id, state, pending);
        return "continue";
      }
      const target = state.linkQueue.shift()!;
      const r = await checkLink(target, opts);
      state.linkResults[target.url] = { ...r, internal: target.internal };
      done++;
      if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
        await checkpoint(audit.id, state, pending);
        sinceCheckpoint = 0;
      }
    }
    if (state.linkQueue.length) state.notes.push(`Checked the first ${MAX_LINK_CHECKS} links to files and other sites.`);
    state.linkQueue = [];
    state.phase = "vitals";
    await checkpoint(audit.id, state, pending);
  }

  // 3. Core Web Vitals (PageSpeed Insights), when the platform has a key.
  let vitals: Vitals[] | null = (audit.vitals as unknown as Vitals[] | null) ?? null;
  if (state.phase === "vitals") {
    const psi = opts.pagespeed ?? (pagespeedConfigured() ? (u: string) => runPagespeed(u, opts.signal) : null);
    if (psi) {
      const okPages = new Set(state.pages.filter((p) => p.status >= 200 && p.status < 300).map((p) => p.url));
      const urls = [state.root, ...(await topPageUrls(audit.businessId, state.host, 5))].filter((u, i, a) => a.indexOf(u) === i && okPages.has(u)).slice(0, 6);
      vitals = [];
      for (const u of urls) {
        if (opts.signal?.aborted) return "continue";
        try {
          const v = vitalsFromPsi(u, await psi(u));
          vitals.push(v);
          pending.push(...vitalsIssues(v));
        } catch (e) {
          logger.warn("PageSpeed check failed", { auditId: audit.id, url: u, ...serializeError(e) });
        }
      }
      const failed = urls.length - vitals.length;
      if (failed > 0) {
        state.notes.push(
          vitals.length
            ? `Page speed couldn't be checked for ${failed} of ${urls.length} pages (PageSpeed Insights didn't answer). The rest are below.`
            : "Page speed (Core Web Vitals) couldn't be checked this time: PageSpeed Insights didn't answer. It will be tried again on the next audit."
        );
      }
    } else {
      state.notes.push("Page speed (Core Web Vitals) wasn't checked: the platform hasn't set up a PageSpeed key.");
    }
    state.phase = "finish";
    await db.$transaction([
      ...(pending.length
        ? [db.auditIssue.createMany({ data: pending.map((i) => ({ auditId: audit.id, pageUrl: i.pageUrl.slice(0, 1000), code: i.code, severity: ISSUE_DEFS[i.code].severity, detail: i.detail ? asJson(i.detail) : undefined })) })]
        : []),
      db.siteAudit.update({ where: { id: audit.id }, data: { state: asJson(state), vitals: vitals ? asJson(vitals) : Prisma.DbNull } }),
    ]);
    pending.length = 0;
  }

  // 4. Site-wide issues, score, done.
  const siteIssues = finalIssues(state);
  const existing = await db.auditIssue.findMany({ where: { auditId: audit.id }, select: { code: true, detail: true } });
  const all = [...existing.filter((i) => isIssueCode(i.code)).map((i) => ({ code: i.code as IssueCode, detail: (i.detail ?? undefined) as Record<string, unknown> | undefined })), ...siteIssues];
  const score = scoreFor(all);
  const summary = { ...summarize(all), notes: state.notes, robotsBlocked: state.robotsBlocked };
  await db.$transaction([
    ...(siteIssues.length
      ? [db.auditIssue.createMany({ data: siteIssues.map((i) => ({ auditId: audit.id, pageUrl: i.pageUrl.slice(0, 1000), code: i.code, severity: ISSUE_DEFS[i.code].severity, detail: i.detail ? asJson(i.detail) : undefined })) })]
      : []),
    db.siteAudit.update({
      where: { id: audit.id },
      data: { status: "done", score, summary: asJson(summary), pagesCrawled: state.pages.length, finishedAt: new Date(), state: Prisma.DbNull, error: null },
    }),
  ]);
  await createNotification({
    businessId: audit.businessId,
    type: "site_audit_done",
    title: `Site audit finished: ${score}/100`,
    message: `${state.pages.length} page${state.pages.length === 1 ? "" : "s"} checked on ${state.host}. ${summary.critical} critical issue${summary.critical === 1 ? "" : "s"}, ${summary.warning} warning${summary.warning === 1 ? "" : "s"}.`,
    data: { auditId: audit.id },
  });
  await pruneAudits(audit.businessId);
  return "done";
}

/** Issues that need the whole crawl: duplicates and links. */
export function finalIssues(state: CrawlState): Issue[] {
  const checks: LinkCheck[] = [];
  for (const p of state.pages) {
    const from = state.refs[p.url] ?? [];
    for (const f of from) {
      if (p.status === 0 || p.status >= 400) checks.push({ from: f, link: p.url, status: p.status, hops: 0, internal: true });
    }
  }
  // A page that redirected: report long chains on the pages that link to it.
  for (const p of state.pages) {
    if (p.hops < 2) continue;
    for (const f of state.refs[p.url] ?? []) checks.push({ from: f, link: p.url, status: 200, hops: p.hops, internal: true });
  }
  for (const [link, r] of Object.entries(state.linkResults)) {
    if (r.status < 0) continue;
    for (const f of state.refs[link] ?? []) checks.push({ from: f, link, status: r.status, hops: r.hops, internal: r.internal });
  }
  const errorPages: Issue[] = state.pages.filter((p) => p.status >= 400 || p.status === 0).map((p) => ({ pageUrl: p.url, code: "page_error" as const, detail: { status: p.status } }));
  return [...errorPages, ...duplicateIssues(state.pages), ...linkIssues(checks)];
}

async function pruneAudits(businessId: string) {
  const old = await db.siteAudit.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, skip: KEEP_AUDITS, select: { id: true } });
  if (old.length) await db.siteAudit.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/** Called by the job when a run throws on its last attempt. */
export async function abandonAudit(auditId: string, e: unknown) {
  const audit = await db.siteAudit.findUnique({ where: { id: auditId } });
  if (!audit || audit.status === "done" || audit.status === "failed") return;
  logger.warn("Site audit abandoned", { auditId, ...serializeError(e) });
  await failAudit(audit, "The audit stopped unexpectedly. Please run it again.");
}

// ─── Starting audits ─────────────────────────────────────────────────

export type AuditTrigger = "manual" | "schedule" | "platform";

/** checkUrl, but a refusal is the tenant's input problem (400), not a server error. */
function requireFetchable(url: string) {
  try {
    checkUrl(url);
  } catch (e) {
    if (e instanceof FetchBlockedError) throw new AppError(`Danets can't audit ${url}: ${e.message}`, { status: 400, code: "AUDIT_URL_BLOCKED" });
    throw e;
  }
}

async function pickRootUrl(businessId: string): Promise<{ url: string | null; owned: OwnedSites; candidates: SiteCandidate[] }> {
  const [settings, sites] = await Promise.all([db.seoSettings.findUnique({ where: { businessId } }), ownedSites(businessId)]);
  const chosen = settings?.auditUrl && isOwnedHost(new URL(settings.auditUrl).hostname, sites.owned) ? settings.auditUrl : sites.candidates[0]?.url ?? null;
  return { url: chosen, ...sites };
}

/**
 * Create an audit and queue its first run. `enqueueRun` is the job queue's
 * enqueue, passed in so this module doesn't import job handlers.
 */
export async function startAudit(
  actor: Actor,
  trigger: AuditTrigger,
  enqueueRun: (auditId: string, businessId: string) => Promise<unknown>,
  now = new Date()
): Promise<SiteAudit> {
  const businessId = actor.businessId;
  const active = await db.siteAudit.findFirst({ where: { businessId, status: { in: ["queued", "running"] } } });
  if (active) throw new AppError("An audit is already running.", { status: 409, code: "AUDIT_RUNNING" });
  if (trigger === "manual") {
    const recent = await db.siteAudit.findFirst({ where: { businessId, trigger: "manual", createdAt: { gt: new Date(now.getTime() - MANUAL_GAP_MS) } } });
    if (recent) {
      const at = new Date(recent.createdAt.getTime() + MANUAL_GAP_MS);
      throw new AppError(`You can run another audit at ${at.toISOString().slice(11, 16)} UTC (once an hour).`, { status: 429, code: "AUDIT_TOO_SOON", details: { nextAt: at.toISOString() } });
    }
  }
  const { url } = await pickRootUrl(businessId);
  if (!url) throw new AppError("Add your website first: connect Search Console, add it to the chat widget's allowed sites, or ask us to build one.", { status: 400, code: "NO_SITE" });
  requireFetchable(url);
  const limits = await getEffectiveLimits(businessId);
  const pageLimit = limits.auditPageLimit > 0 ? Math.min(limits.auditPageLimit, MAX_AUDIT_PAGES) : MAX_AUDIT_PAGES;
  const audit = await db.siteAudit.create({ data: { businessId, rootUrl: url, trigger, pageLimit, requestedBy: actor.name.slice(0, 120) } });
  await enqueueRun(audit.id, businessId);
  if (trigger !== "schedule") log(actor, "seo_audit_started", `Started a site audit of ${url}`, { auditId: audit.id, trigger });
  return audit;
}

// ─── Settings ─────────────────────────────────────────────────────────

export const settingsSchema = z.object({
  auditUrl: z.string().trim().max(300).nullable().optional(),
  auditMonthly: z.boolean().optional(),
});

export async function saveSettings(actor: Actor, input: z.infer<typeof settingsSchema>) {
  const data: { auditUrl?: string | null; auditMonthly?: boolean } = {};
  if (input.auditUrl !== undefined) {
    if (input.auditUrl === null || input.auditUrl === "") data.auditUrl = null;
    else {
      const url = normalizeSiteInput(input.auditUrl);
      if (!url) throw new AppError("Enter a web address like https://example.com", { status: 400, code: "AUDIT_INVALID" });
      const { owned } = await ownedSites(actor.businessId);
      if (!isOwnedHost(new URL(url).hostname, owned)) {
        throw new AppError("That site isn't linked to your account. Add it in Search Console (SEO → Setup) or to the chat widget's allowed sites first.", { status: 400, code: "NOT_OWNED" });
      }
      requireFetchable(url);
      data.auditUrl = url;
    }
  }
  if (input.auditMonthly !== undefined) data.auditMonthly = input.auditMonthly;
  await db.seoSettings.upsert({ where: { businessId: actor.businessId }, create: { businessId: actor.businessId, ...data }, update: data });
  log(actor, "seo_audit_settings", "Updated site audit settings", data);
}

// ─── Reading ─────────────────────────────────────────────────────────

const ISSUES_PER_CODE = 100;

function publicIssue(i: AuditIssue) {
  return { id: i.id, pageUrl: i.pageUrl, detail: i.detail, suggestion: i.suggestion, suggestedAt: i.suggestedAt };
}

export async function auditView(audit: SiteAudit) {
  const issues = await db.auditIssue.findMany({ where: { auditId: audit.id }, orderBy: [{ pageUrl: "asc" }] });
  const byCode = new Map<string, AuditIssue[]>();
  for (const i of issues) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  const order = { critical: 0, warning: 1, notice: 2 };
  const groups = [...byCode.entries()]
    .filter(([code]) => isIssueCode(code))
    .map(([code, list]) => {
      const def = ISSUE_DEFS[code as IssueCode];
      return {
        code,
        label: def.label,
        help: def.help,
        severity: def.severity,
        aiFix: "aiFix" in def && def.aiFix === true,
        count: list.length,
        items: list.slice(0, ISSUES_PER_CODE).map(publicIssue),
      };
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

  // New and fixed since the previous finished audit of the same site.
  let diff: { previousId: string; previousScore: number | null; previousAt: Date | null; newCount: number; fixedCount: number; fixed: { code: string; label: string; pageUrl: string }[] } | null = null;
  if (audit.status === "done") {
    const prev = await db.siteAudit.findFirst({
      where: { businessId: audit.businessId, status: "done", rootUrl: audit.rootUrl, createdAt: { lt: audit.createdAt } },
      orderBy: { createdAt: "desc" },
    });
    if (prev) {
      const prevIssues = await db.auditIssue.findMany({ where: { auditId: prev.id }, select: { code: true, pageUrl: true, detail: true } });
      const now = new Set(issues.map((i) => issueKey({ code: i.code, pageUrl: i.pageUrl, detail: i.detail })));
      const before = new Set(prevIssues.map((i) => issueKey({ code: i.code, pageUrl: i.pageUrl, detail: i.detail })));
      const fixed = prevIssues.filter((i) => !now.has(issueKey({ code: i.code, pageUrl: i.pageUrl, detail: i.detail })));
      diff = {
        previousId: prev.id,
        previousScore: prev.score,
        previousAt: prev.finishedAt,
        newCount: issues.filter((i) => !before.has(issueKey({ code: i.code, pageUrl: i.pageUrl, detail: i.detail }))).length,
        fixedCount: fixed.length,
        fixed: fixed.slice(0, 20).map((i) => ({ code: i.code, label: isIssueCode(i.code) ? ISSUE_DEFS[i.code].label : i.code, pageUrl: i.pageUrl })),
      };
    }
  }
  return {
    id: audit.id,
    rootUrl: audit.rootUrl,
    trigger: audit.trigger,
    status: audit.status,
    pageLimit: audit.pageLimit,
    pagesCrawled: audit.pagesCrawled,
    score: audit.score,
    summary: audit.summary,
    vitals: audit.vitals,
    error: audit.error,
    requestedBy: audit.requestedBy,
    createdAt: audit.createdAt,
    startedAt: audit.startedAt,
    finishedAt: audit.finishedAt,
    groups,
    diff,
  };
}

export async function auditData(businessId: string, auditId?: string | null) {
  const [settings, sites, history] = await Promise.all([
    db.seoSettings.findUnique({ where: { businessId } }),
    pickRootUrl(businessId),
    db.siteAudit.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: KEEP_AUDITS,
      select: { id: true, rootUrl: true, status: true, score: true, pagesCrawled: true, trigger: true, createdAt: true, finishedAt: true },
    }),
  ]);
  const chosen = auditId ? history.find((h) => h.id === auditId) : history[0];
  const audit = chosen ? await db.siteAudit.findUnique({ where: { id: chosen.id } }) : null;
  const lastManual = await db.siteAudit.findFirst({ where: { businessId, trigger: "manual" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const nextManualAt = lastManual && Date.now() - lastManual.createdAt.getTime() < MANUAL_GAP_MS ? new Date(lastManual.createdAt.getTime() + MANUAL_GAP_MS) : null;
  const limits = await getEffectiveLimits(businessId);
  return {
    settings: { auditUrl: settings?.auditUrl ?? null, auditMonthly: settings?.auditMonthly ?? true },
    site: sites.url,
    candidates: sites.candidates,
    pageLimit: limits.auditPageLimit,
    pagespeed: pagespeedConfigured(),
    running: history.some((h) => h.status === "queued" || h.status === "running"),
    nextManualAt,
    history,
    audit: audit ? await auditView(audit) : null,
  };
}

// ─── AI fix suggestions ───────────────────────────────────────────────

export const SUGGEST_FEATURE = "seo_fix";

const suggestionSchema = z.object({
  suggestions: z
    .array(z.object({ for: z.string().max(400).optional(), text: z.string().min(1).max(700) }))
    .min(1)
    .max(5),
});

function suggestionTask(code: IssueCode, detail: Record<string, unknown>, facts: ReturnType<typeof parsePage>): string | null {
  switch (code) {
    case "missing_title":
    case "title_too_long":
    case "title_too_short":
    case "duplicate_title":
      return `Write 3 alternative page titles (the <title> tag) for this page. Each must be 50-60 characters, put the most important words first, describe what this page offers, and differ from other pages on the site. Current title: ${JSON.stringify(facts.title ?? "")}.${code === "duplicate_title" ? " Other pages use the same title, so make it specific to this page." : ""}`;
    case "missing_meta_description":
    case "meta_description_too_long":
    case "duplicate_meta_description":
      return `Write 2 alternative meta descriptions for this page. Each must be 120-155 characters, say what the visitor gets and end with a reason to click. Current description: ${JSON.stringify(facts.metaDescription ?? "")}.`;
    case "missing_h1":
    case "multiple_h1":
      return `Write 3 alternative main headings (H1) for this page, each under 70 characters, saying clearly what the page is about.${facts.h1.length ? ` Current H1 headings: ${JSON.stringify(facts.h1.slice(0, 5))}.` : ""}`;
    case "missing_alt": {
      const images = Array.isArray(detail.images) ? (detail.images as string[]).slice(0, 5) : [];
      if (!images.length) return null;
      return `Write alt text for each of these images on the page (one suggestion per image, with "for" set to the image URL). Describe what the image most likely shows in under 120 characters, using the page's context and the file name; don't start with "Image of". Images: ${images.map((s) => JSON.stringify(s)).join(", ")}.`;
    }
    default:
      return null;
  }
}

export async function suggestFix(actor: Actor, issueId: string, opts: { allowPrivate?: AllowPrivate; lookup?: LookupFn } = {}) {
  const issue = await db.auditIssue.findFirst({ where: { id: issueId, audit: { businessId: actor.businessId } } });
  if (!issue) throw new AppError("Issue not found", { status: 404, code: "NOT_FOUND" });
  if (!isIssueCode(issue.code) || !("aiFix" in ISSUE_DEFS[issue.code])) throw new AppError("There's no AI suggestion for this kind of issue.", { status: 400, code: "AUDIT_INVALID" });
  const { owned } = await ownedSites(actor.businessId);
  if (!isOwnedHost(new URL(issue.pageUrl).hostname, owned)) throw new AppError("This site is no longer linked to your account.", { status: 400, code: "AUDIT_INVALID" });

  let res;
  try {
    res = await safeFetch(issue.pageUrl, { allowPrivate: opts.allowPrivate, lookup: opts.lookup, allowRedirect: (n) => isOwnedHost(n.hostname, owned) });
  } catch (e) {
    throw new AppError(`Couldn't read the page: ${friendlyFetchError(e)}`, { status: 502, code: "AUDIT_FETCH" });
  }
  if (res.status >= 400 || !isHtml(res.contentType)) throw new AppError(`Couldn't read the page (it answered ${res.status}).`, { status: 502, code: "AUDIT_FETCH" });
  const facts = parsePage(res.body, res.url);
  const task = suggestionTask(issue.code, (issue.detail ?? {}) as Record<string, unknown>, facts);
  if (!task) throw new AppError("There's nothing to suggest for this issue.", { status: 400, code: "AUDIT_INVALID" });
  const brand = await getBrandContext(actor.businessId);

  const system = `You are an SEO copywriter improving a small business's own website. Write in the business's voice. Never invent facts, prices, awards or locations the page doesn't support. Reply with JSON only.

Brand voice:
${brand || "No brand voice profile has been set up: write in a clear, friendly, professional voice."}`;
  const user = `Page: ${issue.pageUrl}
Title: ${facts.title ?? "(none)"}
Meta description: ${facts.metaDescription ?? "(none)"}
Headings (H1): ${facts.h1.join(" | ") || "(none)"}
Page text (start):
"""
${facts.textSample.slice(0, 1800)}
"""

Task: ${task}
Return {"suggestions":[{"for"?: string, "text": string}]}.`;

  let result;
  try {
    result = await aiStructured(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      suggestionSchema,
      { businessId: actor.businessId, task: "content", maxTokens: 1200 }
    );
    await logUsage(actor.businessId, SUGGEST_FEATURE, result);
  } catch (e) {
    await logUsage(actor.businessId, SUGGEST_FEATURE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", (e as Error).message);
    if (e instanceof AiRefusalError) throw new AppError("The AI declined to write a suggestion for this page.", { status: 422, code: "AI_REFUSED" });
    throw new AppError("The AI couldn't write a suggestion just now. Please try again.", { status: 502, code: "AI_FAILED" });
  }
  const text = result.data.suggestions.map((s) => (s.for ? `${s.for}\n→ ${s.text}` : s.text)).join("\n\n");
  const updated = await db.auditIssue.update({ where: { id: issue.id }, data: { suggestion: text, suggestedAt: new Date() } });
  return publicIssue(updated);
}

// ─── Monthly schedule ─────────────────────────────────────────────────

/** Businesses due a monthly re-audit: last audit over 30 days old and monthly on. */
export async function dueForMonthlyAudit(now = new Date()): Promise<string[]> {
  const latest = await db.siteAudit.groupBy({ by: ["businessId"], _max: { createdAt: true } });
  const due = latest.filter((l) => l._max.createdAt && now.getTime() - l._max.createdAt.getTime() >= MONTHLY_GAP_MS).map((l) => l.businessId);
  if (!due.length) return [];
  const off = await db.seoSettings.findMany({ where: { businessId: { in: due }, auditMonthly: false }, select: { businessId: true } });
  const offSet = new Set(off.map((o) => o.businessId));
  return due.filter((b) => !offSet.has(b));
}

/** Audits stuck queued/running with no progress for 6 hours are marked failed. */
export async function failStaleAudits(now = new Date()): Promise<number> {
  const stale = await db.siteAudit.findMany({ where: { status: { in: ["queued", "running"] }, updatedAt: { lt: new Date(now.getTime() - 6 * 60 * 60_000) } } });
  for (const a of stale) await failAudit(a, "The audit stopped unexpectedly. Please run it again.");
  return stale.length;
}
