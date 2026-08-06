import { describe, expect, it } from "vitest";
import { planRank } from "@/lib/module-registry";

describe("planRank", () => {
  it("ranks plans in ascending order", () => {
    expect(planRank("free")).toBe(0);
    expect(planRank("starter")).toBeGreaterThan(planRank("free"));
    expect(planRank("pro")).toBeGreaterThan(planRank("starter"));
    expect(planRank("enterprise")).toBeGreaterThanOrEqual(planRank("pro"));
  });

  it("treats unknown plans as free tier", () => {
    expect(planRank("unknown-plan")).toBe(0);
    expect(planRank("")).toBe(0);
  });

  it("identifies upgrades vs downgrades by rank comparison", () => {
    // An upgrade is anything with target rank >= current rank. Same-rank
    // re-applies are treated as upgrades (allowed, no usage check).
    const cases: Array<[string, string, boolean]> = [
      ["free", "starter", true],
      ["starter", "pro", true],
      ["pro", "pro", true],
      ["pro", "starter", false],
      ["enterprise", "free", false],
    ];
    for (const [from, to, expectedUpgrade] of cases) {
      const isUpgrade = planRank(to) >= planRank(from);
      expect(isUpgrade).toBe(expectedUpgrade);
    }
  });
});

// Plan-transition validation logic is exercised through route integration
// tests in the wider test suite. The unit-level guarantees above are the
// safe primitives the route layer relies on for its rank checks.

describe("plan-transitions module exports", () => {
  it("exposes validatePlanTransition and applyPlanTransition", async () => {
    const mod = await import("@/lib/plan-transitions");
    expect(typeof mod.validatePlanTransition).toBe("function");
    expect(typeof mod.applyPlanTransition).toBe("function");
  });
});