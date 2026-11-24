import { describe, it, expect } from "vitest";
import { MAX_VERIFIED_FAILURES, VERIFY_WINDOW_MS, nextWlDomainState } from "@/lib/white-label/domains";

describe("white-label domain state", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  const yes = { verified: true, problem: null };
  const no = { verified: false, problem: "missing" };
  const cfg = (over: Record<string, unknown> = {}) => ({
    customDomain: "app.acme.com",
    domainStatus: "pending",
    domainToken: "t",
    domainRequestedAt: now,
    domainFailures: 0,
    ...over,
  });

  it("verifies when the TXT record matches", () => {
    expect(nextWlDomainState(cfg(), yes, now)).toMatchObject({ domainStatus: "verified", domainVerifiedAt: now, event: "verified", domainError: null });
  });

  it("stays pending while the record is missing", () => {
    expect(nextWlDomainState(cfg(), no, now)).toMatchObject({ domainStatus: "pending", event: null, domainError: "missing" });
  });

  it("fails after the 72-hour window", () => {
    const late = nextWlDomainState(cfg({ domainRequestedAt: new Date(now.getTime() - VERIFY_WINDOW_MS - 1) }), no, now);
    expect(late).toMatchObject({ domainStatus: "failed", event: "failed" });
  });

  it("keeps a verified domain while the record is present", () => {
    expect(nextWlDomainState(cfg({ domainStatus: "verified" }), yes, now)).toMatchObject({ domainStatus: "verified", domainFailures: 0, event: null });
  });

  it("disconnects a verified domain after three failed re-checks", () => {
    const r = nextWlDomainState(cfg({ domainStatus: "verified", domainFailures: MAX_VERIFIED_FAILURES - 1 }), no, now);
    expect(r).toMatchObject({ domainStatus: "failed", event: "lost" });
  });
});