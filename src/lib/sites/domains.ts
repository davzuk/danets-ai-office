import "server-only";
// Custom domains for tenant websites (Phase 2, workstream Q part 2).
//
// A tenant adds www.example.com, then creates two DNS records:
//   CNAME www.example.com          -> sites.<SITES_DOMAIN>   (so visitors reach us)
//   TXT   _danets.www.example.com  -> danets-verify=<token>  (proves they own it)
// The TXT record is what verifies the domain. The CNAME is checked too, but
// only to warn: a proxy like Cloudflare hides it, and the domain still works.
// The site.verify-domains job checks pending domains every 10 minutes for 72
// hours, and re-checks verified ones daily; a verified domain whose TXT record
// is gone three days in a row stops being served.

import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { Prisma, type TenantSite } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { isModuleEnabled } from "@/lib/module-access";
import { logger, serializeError } from "@/lib/logger";
import { customDomainProblem, domainCnameTarget, domainTxtName, normalizeCustomDomain, siteSubdomainFromHost } from "./host";
import { getRenderSite } from "./server";
import type { Actor } from "./service";

export const VERIFY_WINDOW_MS = 72 * 60 * 60_000;
export const RECHECK_VERIFIED_MS = 24 * 60 * 60_000;
export const MAX_VERIFIED_FAILURES = 3;
const MANUAL_CHECK_GAP_MS = 15_000;

export type DomainStatus = "none" | "pending" | "verified" | "failed";

// ─── DNS ───────────────────────────────────────────────────────────

export interface DnsLookup {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
}

/** The system resolver, with short timeouts so a slow zone can't stall the job. */
export function systemDns(): DnsLookup {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  const servers = process.env.SITES_DNS_SERVERS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (servers?.length) r.setServers(servers);
  return r;
}

/** "No such record" is an answer; anything else (timeouts, SERVFAIL) means try again later. */
const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENONAME"]);

async function records<T>(lookup: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lookup();
  } catch (e) {
    if (NO_RECORD.has((e as NodeJS.ErrnoException)?.code ?? "")) return [];
    throw e;
  }
}

const bare = (h: string) => h.toLowerCase().replace(/\.$/, "");

export interface DnsCheck {
  /** The TXT record holds the token: the domain is the tenant's. */
  verified: boolean;
  /** The domain resolves to us (CNAME to the target, or the same addresses). */
  pointsHere: boolean;
  /** For the tenant, when something is missing. */
  problem: string | null;
}

export async function checkDomainDns(domain: string, token: string, target: string | null, dns: DnsLookup): Promise<DnsCheck> {
  const txtName = domainTxtName(domain);
  const txt = (await records(() => dns.resolveTxt(txtName))).map((chunks) => chunks.join("").trim());
  const verified = txt.includes(token);

  let pointsHere = false;
  if (target) {
    const cnames = (await records(() => dns.resolveCname(domain))).map(bare);
    pointsHere = cnames.includes(bare(target));
    if (!pointsHere) {
      // An apex domain can't have a CNAME; ALIAS/ANAME or A records to the
      // same addresses work as well.
      const [mine4, mine6, ours4, ours6] = await Promise.all([
        records(() => dns.resolve4(domain)),
        records(() => dns.resolve6(domain)),
        records(() => dns.resolve4(target)),
        records(() => dns.resolve6(target)),
      ]);
      const ours = new Set([...ours4, ...ours6]);
      pointsHere = [...mine4, ...mine6].some((ip) => ours.has(ip));
    }
  }

  let problem: string | null = null;
  if (!verified) {
    problem = txt.length
      ? `The TXT record on ${txtName} doesn't match. Copy the value again; it changes each time the domain is added.`
      : `We can't see the TXT record on ${txtName} yet. New DNS records can take a few hours to appear.`;
  } else if (!pointsHere && target) {
    problem = `${domain} doesn't point to ${target} yet, so visitors can't reach your website there.`;
  }
  return { verified, pointsHere, problem };
}

// ─── Checking a site's domain ──────────────────────────────────────

type DomainSite = Pick<TenantSite, "id" | "businessId" | "customDomain" | "domainStatus" | "domainToken" | "domainRequestedAt" | "domainFailures">;

export interface DomainUpdate {
  domainStatus: DomainStatus;
  domainCheckedAt: Date;
  domainError: string | null;
  domainFailures: number;
  domainVerifiedAt?: Date;
  /** What changed, for the activity log. */
  event: null | "verified" | "failed" | "lost";
}

/** The next state for a site's domain after a DNS check (pure, for the job and the tests). */
export function nextDomainState(site: DomainSite, check: DnsCheck, now: Date): DomainUpdate {
  const base = { domainCheckedAt: now, domainError: check.problem?.slice(0, 300) ?? null };
  if (site.domainStatus === "verified") {
    if (check.verified) return { ...base, domainStatus: "verified", domainFailures: 0, event: null };
    const failures = site.domainFailures + 1;
    if (failures >= MAX_VERIFIED_FAILURES) {
      return {
        ...base,
        domainStatus: "failed",
        domainFailures: failures,
        domainError: "The verification TXT record was removed, so the domain was disconnected. Add the record back and check again.",
        event: "lost",
      };
    }
    return { ...base, domainStatus: "verified", domainFailures: failures, event: null };
  }
  if (check.verified) return { ...base, domainStatus: "verified", domainFailures: 0, domainVerifiedAt: now, event: "verified" };
  const started = site.domainRequestedAt?.getTime() ?? now.getTime();
  if (now.getTime() - started > VERIFY_WINDOW_MS) {
    return { ...base, domainStatus: "failed", domainFailures: 0, domainError: `${check.problem ?? "Not verified."} We stopped checking after 72 hours; check again once the records are in place.`.slice(0, 300), event: "failed" };
  }
  return { ...base, domainStatus: site.domainStatus === "failed" ? "failed" : "pending", domainFailures: 0, event: null };
}

/** Check one site's domain and save the result. Returns the saved status, or null when there's nothing to check. */
export async function runDomainCheck(siteId: string, opts: { dns?: DnsLookup; now?: Date } = {}): Promise<DomainStatus | null> {
  const site = await db.tenantSite.findUnique({ where: { id: siteId } });
  if (!site?.customDomain || !site.domainToken || site.domainStatus === "none") return null;
  const now = opts.now ?? new Date();
  let check: DnsCheck;
  try {
    check = await checkDomainDns(site.customDomain, site.domainToken, domainCnameTarget(), opts.dns ?? systemDns());
  } catch (e) {
    // The lookup itself failed (timeout, SERVFAIL): keep the status, try next time.
    logger.warn("site domain check failed", { siteId, domain: site.customDomain, ...serializeError(e) });
    await db.tenantSite.update({ where: { id: site.id }, data: { domainCheckedAt: now, domainError: "We couldn't reach your DNS provider just now. We'll try again." } });
    return site.domainStatus as DomainStatus;
  }
  const next = nextDomainState(site, check, now);
  const { event, ...data } = next;
  // Only write if the domain wasn't changed or removed while DNS was answering.
  const saved = await db.tenantSite.updateMany({ where: { id: site.id, customDomain: site.customDomain, domainToken: site.domainToken }, data });
  if (!saved.count) return null;
  if (event) {
    const text = {
      verified: `Connected the domain ${site.customDomain} to the website`,
      failed: `Couldn't verify the domain ${site.customDomain} within 72 hours`,
      lost: `Disconnected the domain ${site.customDomain}: its verification record was removed`,
    }[event];
    await logActivity({ businessId: site.businessId, userName: "Danets", action: `domain_${event}`, module: "sites", description: text, metadata: { siteId: site.id, domain: site.customDomain } });
  }
  return next.domainStatus;
}

/** Sites the job should check now: pending ones, and verified ones not checked for a day. */
export async function domainsDue(now = new Date(), take = 100) {
  return db.tenantSite.findMany({
    where: {
      customDomain: { not: null },
      OR: [
        { domainStatus: "pending" },
        { domainStatus: "verified", OR: [{ domainCheckedAt: null }, { domainCheckedAt: { lt: new Date(now.getTime() - RECHECK_VERIFIED_MS) } }] },
      ],
    },
    select: { id: true },
    orderBy: { domainCheckedAt: { sort: "asc", nulls: "first" } },
    take,
  });
}

// ─── Dashboard actions ─────────────────────────────────────────────

const log = (a: Actor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.userId, userName: a.name, action, module: "sites", description, metadata });

async function siteFor(a: Actor) {
  const site = await db.tenantSite.findUnique({ where: { businessId: a.businessId } });
  if (!site) throw new AppError("Set up your website first.", { status: 404, code: "NO_SITE" });
  return site;
}

export async function requireDomainPlan(businessId: string) {
  if (!(await isModuleEnabled(businessId, "sites_domain"))) {
    throw new AppError("Custom domains are on the Pro plan and above.", { status: 403, code: "PLAN_REQUIRED" });
  }
}

export const newDomainToken = () => `danets-verify=${randomBytes(16).toString("hex")}`;

export async function connectDomain(a: Actor, raw: string) {
  await requireDomainPlan(a.businessId);
  const site = await siteFor(a);
  const domain = normalizeCustomDomain(raw);
  const problem = customDomainProblem(domain);
  if (problem) throw new AppError(problem, { status: 400, code: "INVALID_DOMAIN" });
  if (site.customDomain === domain && site.domainStatus !== "none") return site;
  try {
    const updated = await db.tenantSite.update({
      where: { id: site.id },
      data: {
        customDomain: domain,
        domainStatus: "pending",
        domainToken: newDomainToken(),
        domainRequestedAt: new Date(),
        domainCheckedAt: null,
        domainVerifiedAt: null,
        domainError: null,
        domainFailures: 0,
      },
    });
    await log(a, "domain_added", `Added the domain ${domain} to the website${site.customDomain ? ` (replacing ${site.customDomain})` : ""}`, { domain, previous: site.customDomain });
    return updated;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("Another website already uses that domain.", { status: 409, code: "DOMAIN_TAKEN" });
    }
    throw e;
  }
}

export const DOMAIN_CLEARED = {
  customDomain: null,
  domainStatus: "none",
  domainToken: null,
  domainRequestedAt: null,
  domainCheckedAt: null,
  domainVerifiedAt: null,
  domainError: null,
  domainFailures: 0,
} as const;

export async function removeDomain(a: Actor) {
  const site = await siteFor(a);
  if (!site.customDomain) return site;
  const updated = await db.tenantSite.update({ where: { id: site.id }, data: DOMAIN_CLEARED });
  await log(a, "domain_removed", `Removed the domain ${site.customDomain} from the website`, { domain: site.customDomain });
  return updated;
}

/** "Check now" from the dashboard. A failed domain gets a fresh 72-hour window. */
export async function checkDomainNow(a: Actor, dns?: DnsLookup) {
  await requireDomainPlan(a.businessId);
  const site = await siteFor(a);
  if (!site.customDomain || site.domainStatus === "none") throw new AppError("Add a domain first.", { status: 400, code: "NO_DOMAIN" });
  if (site.domainCheckedAt && Date.now() - site.domainCheckedAt.getTime() < MANUAL_CHECK_GAP_MS) {
    throw new AppError("Checked a moment ago. Try again in a few seconds.", { status: 429, code: "TOO_SOON" });
  }
  if (site.domainStatus === "failed") {
    await db.tenantSite.update({ where: { id: site.id }, data: { domainStatus: "pending", domainRequestedAt: new Date(), domainFailures: 0 } });
  }
  await runDomainCheck(site.id, { dns });
  return db.tenantSite.findUniqueOrThrow({ where: { id: site.id } });
}

// ─── TLS "ask" ─────────────────────────────────────────────────────

/**
 * Whether the TLS proxy may get a certificate for a host: an existing,
 * servable tenant subdomain, or a verified custom domain on a plan that
 * allows it. Everything else is refused, so nobody can make us request
 * certificates for arbitrary names pointed at the server.
 */
export async function mayIssueCertificate(rawHost: string): Promise<boolean> {
  const host = normalizeCustomDomain(rawHost);
  if (!host) return false;
  try {
    // The raw value keeps a development port ("acme.localhost:3000").
    const sub = siteSubdomainFromHost(rawHost.trim().toLowerCase()) ?? siteSubdomainFromHost(host);
    if (sub) return !!(await getRenderSite(sub));
    if (customDomainProblem(host)) return false;
    const site = await getRenderSite(host);
    return !!site && site.customOrigin !== null;
  } catch (e) {
    logger.warn("certificate check failed", { host, ...serializeError(e) });
    return false;
  }
}

export function domainView(site: Pick<TenantSite, "customDomain" | "domainStatus" | "domainToken" | "domainCheckedAt" | "domainVerifiedAt" | "domainError" | "domainRequestedAt">) {
  if (!site.customDomain || site.domainStatus === "none") return null;
  return {
    domain: site.customDomain,
    status: site.domainStatus as DomainStatus,
    txtName: domainTxtName(site.customDomain),
    txtValue: site.domainToken,
    cnameTarget: domainCnameTarget(),
    requestedAt: site.domainRequestedAt,
    checkedAt: site.domainCheckedAt,
    verifiedAt: site.domainVerifiedAt,
    problem: site.domainError,
  };
}
