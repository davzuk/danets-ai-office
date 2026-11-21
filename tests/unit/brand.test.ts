import { describe, expect, it } from "vitest";
import {
  BRAND_LIMITS,
  brandProfileInputSchema,
  buildBrandContext,
  EMPTY_BRAND_PROFILE,
  normalizeBrandProfile,
  type BrandProfileInput,
} from "@/lib/brand-schema";
import { toStructuredJsonSchema } from "@/lib/llm/schema";
import { generatedBrandSchema } from "@/lib/brand-schema";

const profile: BrandProfileInput = {
  summary: "Acme Dental runs two family clinics in Lekki offering check-ups, whitening and braces.",
  audience: [{ segment: "Busy parents", pains: ["No time for appointments"], desires: ["Weekend slots"] }],
  tone: { adjectives: ["warm", "reassuring"], formality: 3, emoji: false },
  valueProps: ["Open Saturdays", "Same-week appointments"],
  offers: [{ name: "Family check-up", price: "₦25,000", cta: "Book online", url: "https://acme.example/book" }],
  doPhrases: ["your smile"],
  dontPhrases: ["painless", "cheap"],
  locales: ["en-NG"],
  websiteUrl: "https://acme.example",
};

describe("buildBrandContext", () => {
  it("is byte-identical across calls for the same profile", () => {
    const a = buildBrandContext("Acme Dental", profile);
    const b = buildBrandContext("Acme Dental", structuredClone(profile));
    const c = buildBrandContext("Acme Dental", JSON.parse(JSON.stringify(profile)));
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps
  });

  it("includes every section in a fixed order", () => {
    const ctx = buildBrandContext("Acme Dental", profile);
    const order = ["# Brand voice: Acme Dental", "## About", "## Voice", "## Audience", "## Why customers choose us", "## Offers", "## Say", "## Never say", "## Languages", "## Website"];
    const positions = order.map((h) => ctx.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(ctx).toContain("- Family check-up (₦25,000): Book online <https://acme.example/book>");
    expect(ctx).toContain("- Emoji: do not use");
    expect(ctx).toContain("- Busy parents | pains: No time for appointments | wants: Weekend slots");
  });

  it("changes when the profile changes", () => {
    const edited = { ...profile, tone: { ...profile.tone, emoji: true } };
    expect(buildBrandContext("Acme Dental", edited)).not.toBe(buildBrandContext("Acme Dental", profile));
  });

  it("is empty when nothing is set", () => {
    expect(buildBrandContext("Acme", null)).toBe("");
    expect(buildBrandContext("Acme", EMPTY_BRAND_PROFILE)).toBe("");
  });
});

describe("normalizeBrandProfile", () => {
  it("clamps model output into the saved shape", () => {
    const n = normalizeBrandProfile({
      summary: "x".repeat(5000),
      tone: { adjectives: ["a", "a", "b", " ", "c", "d", "e", "f", "g"], formality: 9, emoji: "yes" },
      valueProps: Array.from({ length: 20 }, (_, i) => `v${i}`),
      offers: [
        { name: "Ok", cta: "Buy", price: "", url: "javascript:alert(1)" },
        { name: "", cta: "Missing name" },
      ],
      audience: [{ segment: "S", pains: "not a list", desires: ["d"] }, { nope: true }],
      locales: null,
      websiteUrl: "not a url",
    });
    expect(n.summary).toHaveLength(BRAND_LIMITS.summary);
    expect(n.tone).toEqual({ adjectives: ["a", "b", "c", "d", "e", "f"], formality: 5, emoji: false });
    expect(n.valueProps).toHaveLength(BRAND_LIMITS.valueProps);
    expect(n.offers).toEqual([{ name: "Ok", cta: "Buy", price: null, url: null }]);
    expect(n.audience).toEqual([{ segment: "S", pains: [], desires: ["d"] }]);
    expect(n.locales).toEqual([]);
    expect(n.websiteUrl).toBeNull();
    expect(brandProfileInputSchema.safeParse(n).success).toBe(true);
  });

  it("round-trips a valid profile unchanged", () => {
    expect(normalizeBrandProfile(profile)).toEqual(profile);
  });

  it("turns null into the empty profile", () => {
    expect(normalizeBrandProfile(null)).toEqual(EMPTY_BRAND_PROFILE);
  });
});

describe("generation schema", () => {
  it("is structured-output friendly: every property required, no extra keys", () => {
    const js = toStructuredJsonSchema(generatedBrandSchema) as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
    expect(js.additionalProperties).toBe(false);
    expect(js.required.sort()).toEqual(Object.keys(js.properties).sort());
  });
});
