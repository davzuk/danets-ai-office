import "server-only";
// Verification for white-label custom domains. A tenant points their own
// domain at the app, proves ownership with a TXT record, and the
// white-label.verify-domains job checks every 10 minutes for 72 hours.

import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { customDomainProblem, domainTxtName, normalizeCustomDomain } from "@/lib/sites/host";
import { checkDomainDns, newDomainToken, systemDns, type DnsLookup } from "@/lib/sites/domains";
import { type WhiteLabelConfig } from "@prisma/client";

export const VERIFY_WINDOW_MS = 72 * 60 * 60_000;
export const RECHECK_VERIFIED_MS = 24 * 60 * 60_000;
export const MAX_VERIFIED_FAILURES = 3;
const MANUAL_CHECK_GAP_MS = 15_000;

export type DomainStatus = "none" | "pending" | "verified" | "failed";

type DomainConfig = Pick<WhiteLabelConfig, "customDomain" | "domainStatus" | "domainToken" | "domainRequestedAt" | "domainFailures">;

export interface DomainUpdate {
  domainStatus: DomainStatus;
  domainCheckedAt: Date;
  domainError: string | null;
  domainFailures: number;
  domainVerifiedAt?: Date;
  event: null | "verified" | "failed" | "lost";
}

/** The next state for a white-label domain after a DNS check (pure, for the job and tests). */
export function nextWlDomainState(cfg: DomainConfig, check: { verified: boolean; problem: string | null }, now: Date): DomainUpdate {
  const base = { domainCheckedAt: now, domainError: check.problem?.slice(0, 300) ?? null };
  if (cfg.domainStatus === "verified") {
    if (check.verified) return { ...base, domainStatus: "verified", domainFailures: 0, event: null };
    const failures = cfg.domainFailures + 1;
    if (failures >= MAX_VERIFIED_FAILURES) {
      return { ...base, domainStatus: "failed", domainFailures: failures, domainError: "The verification TXT record was removed, so the domain was disconnected. Add it back and check again.", event: "lost" };
    }
    return { ...base, domainStatus: "verified", domainFailures: failures, event: null };
  }
  if (check.verified) return { ...base, domainStatus: "verified", domainFailures: 0, domainVerifiedAt: now, event: "verified" };
  const started = cfg.domainRequestedAt?.getTime() ?? now.getTime();
  if (now.getTime() - started > VERIFY_WINDOW_MS) {
    return { ...base, domainStatus: "failed", domainFailures: 0, domainError: `${check.problem ?? "Not verified."} We stopped checking after 72 hours; check again once the record is in place.`.slice(0, 300), event: "failed" };
  }
  return { ...base, domainStatus: cfg.domainStatus === "failed" ? "failed" : "pending", domainFailures: 0, event: null };
}

/** Check one business's domain and save the result. Returns the saved status, or null when there's nothing to check. */
export async function runWlDomainCheck(businessId: string, opts: { dns?: DnsLookup; now?: Date } = {}): Promise<DomainStatus | null> {
  const cfg = await db.whiteLabelConfig.findUnique({ where: { businessId } });
  if (!cfg?.customDomain || !cfg.domainToken || cfg.domainStatus === "none") return null;
  const now = opts.now ?? new Date();
  let check;
  try {
    check = await checkDomainDns(cfg.customDomain, cfg.domainToken, null, opts.dns ?? systemDns());
  } catch (e) {
    logger.warn("white-label domain check failed", { businessId, domain: cfg.customDomain, ...serializeError(e) });
    await db.whiteLabelConfig.update({ where: { id: cfg.id }, data: { domainCheckedAt: now, domainError: "We couldn't reach your DNS provider just now. We'll try again." } });
    return cfg.domainStatus as DomainStatus;
  }
  const next = nextWlDomainState(cfg, check, now);
  const { event, ...data } = next;
  const saved = await db.whiteLabelConfig.updateMany({ where: { id: cfg.id, customDomain: cfg.customDomain, domainToken: cfg.domainToken }, data });
  if (!saved.count) return null;
  return next.domainStatus;
}

/** Businesses the job should check now: pending ones, and verified ones not checked for a day. */
export async function wlDomainsDue(now = new Date(), take = 100) {
  return db.whiteLabelConfig.findMany({
    where: {
      customDomain: { not: null },
      OR: [
        { domainStatus: "pending" },
        { domainStatus: "verified", OR: [{ domainCheckedAt: null }, { domainCheckedAt: { lt: new Date(now.getTime() - RECHECK_VERIFIED_MS) } }] },
      ],
    },
    select: { businessId: true },
    orderBy: { domainCheckedAt: { sort: "asc", nulls: "first" } },
    take,
  });
}

export async function requireWhiteLabelPlan(businessId: string) {
  if (!(await isModuleEnabled(businessId, "white_label"))) {
    throw new AppError("White-label custom domains are on the Enterprise plan.", { status: 403, code: "PLAN_REQUIRED" });
  }
}

/** Attach a new domain and kick off verification, or re-attach after a change. */
export async function connectWlDomain(businessId: string, raw: string) {
  await requireWhiteLabelPlan(businessId);
  const domain = normalizeCustomDomain(raw);
  const problem = customDomainProblem(domain);
  if (problem) throw new AppError(problem, { status: 400, code: "INVALID_DOMAIN" });
  const existing = await db.whiteLabelConfig.findUnique({ where: { businessId } });
  if (!existing) {
    return db.whiteLabelConfig.create({ data: { businessId, customDomain: domain, domainStatus: "pending", domainToken: newDomainToken(), domainRequestedAt: new Date(), isActive: false } });
  }
  if (existing.customDomain === domain && existing.domainStatus !== "none") return existing;
  try {
    return await db.whiteLabelConfig.update({
      where: { id: existing.id },
      data: { customDomain: domain, domainStatus: "pending", domainToken: newDomainToken(), domainRequestedAt: new Date(), domainCheckedAt: null, domainVerifiedAt: null, domainError: null, domainFailures: 0 },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new AppError("Another business already uses that domain.", { status: 409, code: "DOMAIN_TAKEN" });
    throw e;
  }
}

export async function clearWlDomain(businessId: string) {
  const cfg = await db.whiteLabelConfig.findUnique({ where: { businessId } });
  if (!cfg) return db.whiteLabelConfig.create({ data: { businessId, customDomain: null, domainStatus: "none" } });
  return db.whiteLabelConfig.update({ where: { id: cfg.id }, data: { customDomain: null, domainStatus: "none", domainToken: null, domainRequestedAt: null, domainCheckedAt: null, domainVerifiedAt: null, domainError: null, domainFailures: 0 } });
}

/** "Check now" from settings. A failed domain gets a fresh 72-hour window. */
export async function checkWlDomainNow(businessId: string, dns?: DnsLookup) {
  await requireWhiteLabelPlan(businessId);
  const cfg = await db.whiteLabelConfig.findUnique({ where: { businessId } });
  if (!cfg || !cfg.customDomain || cfg.domainStatus === "none") throw new AppError("Add a domain first.", { status: 400, code: "NO_DOMAIN" });
  if (cfg.domainCheckedAt && Date.now() - cfg.domainCheckedAt.getTime() < MANUAL_CHECK_GAP_MS) {
    throw new AppError("Checked a moment ago. Try again in a few seconds.", { status: 429, code: "TOO_SOON" });
  }
  if (cfg.domainStatus === "failed") {
    await db.whiteLabelConfig.update({ where: { id: cfg.id }, data: { domainStatus: "pending", domainRequestedAt: new Date(), domainFailures: 0 } });
  }
  await runWlDomainCheck(businessId, { dns });
  return db.whiteLabelConfig.findUniqueOrThrow({ where: { businessId } });
}

export function wlDomainView(cfg: Pick<WhiteLabelConfig, "customDomain" | "domainStatus" | "domainToken" | "domainCheckedAt" | "domainVerifiedAt" | "domainError" | "domainRequestedAt">) {
  if (!cfg.customDomain || cfg.domainStatus === "none") return null;
  return {
    domain: cfg.customDomain,
    status: cfg.domainStatus as DomainStatus,
    txtName: domainTxtName(cfg.customDomain),
    txtValue: cfg.domainToken,
    requestedAt: cfg.domainRequestedAt,
    checkedAt: cfg.domainCheckedAt,
    verifiedAt: cfg.domainVerifiedAt,
    problem: cfg.domainError,
  };
}

/** True when this hostname is an active, verified white-label login domain. */
export async function isVerifiedWhiteLabelDomain(host: string): Promise<boolean> {
  const cfg = await db.whiteLabelConfig.findFirst({ where: { customDomain: host, isActive: true, domainStatus: "verified" }, select: { id: true } });
  return !!cfg;
}