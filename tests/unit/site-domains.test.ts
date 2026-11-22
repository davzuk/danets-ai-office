import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const {
  appHostnames,
  customDomainFromHost,
  customDomainOrigin,
  customDomainProblem,
  domainCnameTarget,
  domainTxtName,
  isSitesOnlyHost,
  normalizeCustomDomain,
} = await import("@/lib/sites/host");
const { checkDomainDns, nextDomainState, newDomainToken, MAX_VERIFIED_FAILURES, VERIFY_WINDOW_MS } = await import("@/lib/sites/domains");
type DnsLookup = import("@/lib/sites/domains").DnsLookup;

const prod = { NODE_ENV: "production", SITES_DOMAIN: "danets.site", NEXT_PUBLIC_APP_URL: "https://app.danets.com", APP_HOSTS: "danets.com,www.danets.com" };
const dev = { NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };

describe("custom domain names", () => {
  it("normalizes what tenants type", () => {
    expect(normalizeCustomDomain(" https://WWW.Acme.com/about?x=1 ")).toBe("www.acme.com");
    expect(normalizeCustomDomain("acme.com.")).toBe("acme.com");
    expect(normalizeCustomDomain("shop.acme.co.uk:443")).toBe("shop.acme.co.uk");
  });

  it("refuses names that aren't the tenant's own public domain", () => {
    expect(customDomainProblem("www.acme.com", prod)).toBeNull();
    expect(customDomainProblem("acme.com", prod)).toBeNull();
    expect(customDomainProblem("acme", prod)).toMatch(/like www/);
    expect(customDomainProblem("1.2.3.4", prod)).toMatch(/like www/);
    expect(customDomainProblem("-acme.com", prod)).toMatch(/like www/);
    expect(customDomainProblem("acme..com", prod)).toMatch(/like www/);
    expect(customDomainProblem("bob.danets.site", prod)).toMatch(/Danets address/);
    expect(customDomainProblem("danets.site", prod)).toMatch(/Danets address/);
    expect(customDomainProblem("app.danets.com", prod)).toMatch(/platform/);
    expect(customDomainProblem("www.danets.com", prod)).toMatch(/platform/);
    expect(customDomainProblem("acme.localhost", prod)).toMatch(/public domain/);
    expect(customDomainProblem("www.acme.localhost", dev)).toBeNull();
  });

  it("knows the app's own hostnames", () => {
    expect([...appHostnames(prod)]).toEqual(expect.arrayContaining(["app.danets.com", "danets.com", "www.danets.com", "localhost", "127.0.0.1"]));
  });

  it("treats only other hosts as custom domains", () => {
    expect(customDomainFromHost("www.acme.com", prod)).toBe("www.acme.com");
    expect(customDomainFromHost("WWW.ACME.COM:443", prod)).toBe("www.acme.com");
    expect(customDomainFromHost("app.danets.com", prod)).toBeNull();
    expect(customDomainFromHost("bob.danets.site", prod)).toBeNull();
    expect(customDomainFromHost("10.0.0.5", prod)).toBeNull();
    expect(customDomainFromHost("localhost:3000", dev)).toBeNull();
    expect(customDomainFromHost("www.acme.localhost:3000", dev)).toBe("www.acme.localhost");
    // No sites domain, no tenant sites at all.
    expect(customDomainFromHost("www.acme.com", { NODE_ENV: "production" })).toBeNull();
  });

  it("finds sites-domain hosts that serve nothing", () => {
    expect(isSitesOnlyHost("danets.site", prod)).toBe(true);
    expect(isSitesOnlyHost("sites.danets.site", prod)).toBe(true);
    expect(isSitesOnlyHost("bob.danets.site", prod)).toBe(false);
    expect(isSitesOnlyHost("localhost:3000", dev)).toBe(false);
  });

  it("builds origins and DNS names", () => {
    expect(customDomainOrigin("www.acme.com", prod)).toBe("https://www.acme.com");
    expect(customDomainOrigin("www.acme.localhost", dev)).toBe("http://www.acme.localhost:3000");
    expect(domainCnameTarget(prod)).toBe("sites.danets.site");
    expect(domainCnameTarget(dev)).toBe("sites.localhost");
    expect(domainTxtName("www.acme.com")).toBe("_danets.www.acme.com");
    expect(newDomainToken()).toMatch(/^danets-verify=[0-9a-f]{32}$/);
    expect(newDomainToken().length).toBeLessThanOrEqual(64);
  });
});

const nxdomain = () => Object.assign(new Error("not found"), { code: "ENOTFOUND" });

function fakeDns(zone: { txt?: Record<string, string[][]>; cname?: Record<string, string[]>; a?: Record<string, string[]> }, fail?: string): DnsLookup {
  const get = <T>(m: Record<string, T[]> | undefined, name: string) => {
    if (fail === name) return Promise.reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" }));
    const v = m?.[name];
    return v ? Promise.resolve(v) : Promise.reject(nxdomain());
  };
  return {
    resolveTxt: (n) => get(zone.txt, n),
    resolveCname: (n) => get(zone.cname, n),
    resolve4: (n) => get(zone.a, n),
    resolve6: () => Promise.reject(nxdomain()),
  };
}

describe("DNS check", () => {
  const token = "danets-verify=abc";
  const target = "sites.danets.site";

  it("verifies on the TXT record and checks the CNAME", async () => {
    const ok = await checkDomainDns("www.acme.com", token, target, fakeDns({ txt: { "_danets.www.acme.com": [["danets-verify=", "abc"]] }, cname: { "www.acme.com": ["Sites.Danets.Site."] } }));
    expect(ok).toEqual({ verified: true, pointsHere: true, problem: null });
  });

  it("accepts an apex domain pointing at the same addresses", async () => {
    const r = await checkDomainDns("acme.com", token, target, fakeDns({ txt: { "_danets.acme.com": [[token]] }, a: { "acme.com": ["203.0.113.7"], [target]: ["203.0.113.7"] } }));
    expect(r.pointsHere).toBe(true);
  });

  it("explains what's missing", async () => {
    const none = await checkDomainDns("www.acme.com", token, target, fakeDns({}));
    expect(none.verified).toBe(false);
    expect(none.problem).toMatch(/can't see the TXT record on _danets.www.acme.com/);
    const wrong = await checkDomainDns("www.acme.com", token, target, fakeDns({ txt: { "_danets.www.acme.com": [["danets-verify=old"]] } }));
    expect(wrong.problem).toMatch(/doesn't match/);
    const notPointing = await checkDomainDns("www.acme.com", token, target, fakeDns({ txt: { "_danets.www.acme.com": [[token]] }, a: { "www.acme.com": ["198.51.100.1"] } }));
    expect(notPointing).toMatchObject({ verified: true, pointsHere: false });
    expect(notPointing.problem).toMatch(/doesn't point to sites.danets.site/);
  });

  it("lets a lookup failure through so the status isn't changed", async () => {
    await expect(checkDomainDns("www.acme.com", token, target, fakeDns({}, "_danets.www.acme.com"))).rejects.toThrow("timeout");
  });
});

describe("domain state", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const site = (over: Partial<Parameters<typeof nextDomainState>[0]> = {}) => ({
    id: "s1",
    businessId: "b1",
    customDomain: "www.acme.com",
    domainStatus: "pending",
    domainToken: "t",
    domainRequestedAt: new Date(now.getTime() - 60 * 60_000),
    domainFailures: 0,
    ...over,
  });
  const yes = { verified: true, pointsHere: true, problem: null };
  const no = { verified: false, pointsHere: false, problem: "missing" };

  it("verifies a pending domain", () => {
    expect(nextDomainState(site(), yes, now)).toMatchObject({ domainStatus: "verified", domainVerifiedAt: now, event: "verified", domainError: null });
  });

  it("keeps waiting for 72 hours, then fails", () => {
    expect(nextDomainState(site(), no, now)).toMatchObject({ domainStatus: "pending", event: null, domainError: "missing" });
    const late = nextDomainState(site({ domainRequestedAt: new Date(now.getTime() - VERIFY_WINDOW_MS - 1) }), no, now);
    expect(late).toMatchObject({ domainStatus: "failed", event: "failed" });
    expect(late.domainError).toMatch(/72 hours/);
  });

  it("drops a verified domain only after its TXT record is gone several days running", () => {
    let s = site({ domainStatus: "verified" });
    for (let i = 1; i < MAX_VERIFIED_FAILURES; i++) {
      const r = nextDomainState(s, no, now);
      expect(r).toMatchObject({ domainStatus: "verified", domainFailures: i, event: null });
      s = site({ domainStatus: "verified", domainFailures: r.domainFailures });
    }
    expect(nextDomainState(s, no, now)).toMatchObject({ domainStatus: "failed", event: "lost" });
    expect(nextDomainState(site({ domainStatus: "verified", domainFailures: 2 }), yes, now)).toMatchObject({ domainStatus: "verified", domainFailures: 0 });
  });

  it("keeps a verified domain that only lost its CNAME, with a warning", () => {
    const r = nextDomainState(site({ domainStatus: "verified" }), { verified: true, pointsHere: false, problem: "not pointing" }, now);
    expect(r).toMatchObject({ domainStatus: "verified", domainError: "not pointing", event: null });
  });
});
