import "server-only";
// Domain verification primitives. Website custom domains were removed in the
// platform-only rework (a tenant's own domain is a white-label login domain),
// so this file keeps only the DNS/TXT check used by the TLS "ask" endpoint and,
// next, white-label login domains.

import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { customDomainProblem, domainTxtName, normalizeCustomDomain, siteSubdomainFromHost } from "./host";
import { getRenderSite } from "./server";

export interface DnsLookup {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
}

/** The system resolver, with short timeouts so a slow zone can't stall a check. */
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
    problem = `${domain} doesn't point to ${target} yet, so visitors can't reach us there.`;
  }
  return { verified, pointsHere, problem };
}

export const newDomainToken = () => `danets-verify=${randomBytes(16).toString("hex")}`;

// ─── TLS "ask" ─────────────────────────────────────────────────────

/**
 * Whether the TLS proxy may get a certificate for a host: an existing,
 * servable tenant subdomain. Everything else is refused, so nobody can make
 * us request certificates for arbitrary names pointed at the server.
 */
export async function mayIssueCertificate(rawHost: string): Promise<boolean> {
  const sub = siteSubdomainFromHost(rawHost.trim().toLowerCase());
  if (sub) {
    try {
      return !!(await getRenderSite(sub));
    } catch (e) {
      logger.warn("certificate check failed", { host: rawHost, ...serializeError(e) });
      return false;
    }
  }
  // A verified, active white-label login domain also gets a certificate.
  const host = normalizeCustomDomain(rawHost);
  if (!host || customDomainProblem(host)) return false;
  try {
    const wl = await db.whiteLabelConfig.findFirst({
      where: { customDomain: host, isActive: true, domainStatus: "verified" },
      select: { id: true },
    });
    return !!wl;
  } catch (e) {
    logger.warn("certificate check failed", { host, ...serializeError(e) });
    return false;
  }
}