import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { magnetLinkParams, verifyMagnetLink, LINK_TTL_MS } = await import("@/lib/magnets/link");
const { toMagnet } = await import("@/lib/magnets/generate");
const { triggerConfigMatches } = await import("@/lib/automation");

const env = { MAGNET_LINK_SECRET: "test-secret" };
const M = "cmagnet0000000001";
const S = "csubmission000001";

describe("lead magnet download links", () => {
  const now = 1_800_000_000_000;

  it("accepts a fresh link", () => {
    const q = magnetLinkParams(M, S, now, env);
    const r = verifyMagnetLink(q, now + 1000, env);
    expect(r).toEqual({ ok: true, link: { magnetId: M, submissionId: S, exp: now + LINK_TTL_MS } });
  });

  it("refuses a link after it expires", () => {
    const q = magnetLinkParams(M, S, now, env);
    expect(verifyMagnetLink(q, now + LINK_TTL_MS + 1, env)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses tampering with any part", () => {
    const q = magnetLinkParams(M, S, now, env);
    expect(verifyMagnetLink({ ...q, m: "cmagnet0000000002" }, now, env).ok).toBe(false);
    expect(verifyMagnetLink({ ...q, s: "csubmission000002" }, now, env).ok).toBe(false);
    expect(verifyMagnetLink({ ...q, e: String(now + LINK_TTL_MS * 10) }, now, env).ok).toBe(false);
    expect(verifyMagnetLink({ ...q, sig: q.sig.slice(0, -1) + (q.sig.endsWith("A") ? "B" : "A") }, now, env).ok).toBe(false);
  });

  it("refuses links signed with another secret, and malformed input", () => {
    const q = magnetLinkParams(M, S, now, { MAGNET_LINK_SECRET: "other" });
    expect(verifyMagnetLink(q, now, env)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyMagnetLink({}, now, env).ok).toBe(false);
    expect(verifyMagnetLink({ ...magnetLinkParams(M, S, now, env), e: "12abc" }, now, env).ok).toBe(false);
    expect(verifyMagnetLink({ ...magnetLinkParams(M, S, now, env), m: "../x" }, now, env).ok).toBe(false);
  });

  it("needs a secret in production", () => {
    expect(() => magnetLinkParams(M, S, now, { NODE_ENV: "production" })).toThrow(/MAGNET_LINK_SECRET/);
  });
});

describe("AI-written lead magnets", () => {
  const out = {
    title: "  The roof checklist  ",
    description: "For homeowners.",
    bullets: ["Ten checks", "", "Costs to expect", "a", "b", "c", "d"],
    intro: "Before you replace a roof…",
    sections: [
      { heading: "Inspect", paragraph: "", items: ["Look for missing tiles", " "] },
      { heading: "", paragraph: "dropped: no heading", items: ["x"] },
      { heading: "Empty", paragraph: "", items: [] },
    ],
    closing: "Call us for a free look.",
  };

  it("trims and drops empty parts", () => {
    const m = toMagnet(out);
    expect(m.title).toBe("The roof checklist");
    expect(m.bullets).toHaveLength(6);
    expect(m.content.sections).toEqual([{ heading: "Inspect", paragraph: "", items: ["Look for missing tiles"] }]);
  });

  it("fails when nothing usable comes back", () => {
    expect(() => toMagnet({ ...out, sections: [] })).toThrow(/usable/);
  });
});

describe("lead_magnet_downloaded workflows", () => {
  const ctx = { businessId: "b1", leadId: "l1", leadMagnetId: M };
  it("matches any magnet, or only the chosen one", () => {
    expect(triggerConfigMatches("lead_magnet_downloaded", {}, ctx)).toBe(true);
    expect(triggerConfigMatches("lead_magnet_downloaded", { leadMagnetId: M }, ctx)).toBe(true);
    expect(triggerConfigMatches("lead_magnet_downloaded", { leadMagnetId: "other" }, ctx)).toBe(false);
  });
});
