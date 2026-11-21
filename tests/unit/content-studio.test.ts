import { beforeEach, describe, expect, it, vi } from "vitest";

const aiStructured = vi.fn();
const logUsage = vi.fn();
vi.mock("@/lib/llm", () => ({
  aiStructured: (...a: unknown[]) => aiStructured(...a),
  logUsage: (...a: unknown[]) => logUsage(...a),
  AiRefusalError: class AiRefusalError extends Error {},
}));

const {
  PLATFORM_RULES,
  checkVariant,
  composeText,
  findBannedPhrases,
  hasErrors,
  normalizeHashtags,
  platformLength,
  scrubBannedPhrases,
  xWeightedLength,
} = await import("@/lib/content/platforms");
const { buildContentSystemPrompt, enforceHardLimits, generateVariants } = await import("@/lib/content/generate");

const ctx = {
  businessName: "Acme Dental",
  brandContext: "# Brand voice: Acme Dental\n## Never say\n- cheapest\n- best in town",
  dontPhrases: ["cheapest", "best in town"],
  facts: [{ title: "Opening hours", content: "Mon-Fri 9-5, Saturday 9-2." }],
};

const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20, provider: "anthropic", model: "m", content: "", stopReason: "end_turn", latencyMs: 1 };
const reply = (variants: unknown[]) => ({ ...usage, data: { variants } });

describe("platform rules", () => {
  it("counts X the way X does: URLs are 23, CJK and emoji 2", () => {
    expect(xWeightedLength("hello https://example.com/a/very/long/path?x=1")).toBe(6 + 23);
    expect(xWeightedLength("日本")).toBe(4);
    expect(xWeightedLength("🙂")).toBe(2);
    const text = composeText("x", { body: "Open Saturdays!", hashtags: ["dentist"], linkUrl: "https://acme.example/book" });
    expect(text).toBe("Open Saturdays!\n\nhttps://acme.example/book\n\n#dentist");
    expect(platformLength("x", text)).toBe(15 + 2 + 23 + 2 + 8);
  });

  it("flags hard errors and soft warnings separately", () => {
    const ig = checkVariant("instagram", { body: "Book at https://acme.example", hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) });
    expect(ig.map((i) => i.code)).toEqual(expect.arrayContaining(["too_many_hashtags", "link_not_clickable"]));
    expect(hasErrors(ig)).toBe(true);
    const fb = checkVariant("facebook", { body: "x".repeat(800), hashtags: [] });
    expect(fb).toEqual([expect.objectContaining({ severity: "warning", code: "long" })]);
    expect(hasErrors(checkVariant("x", { body: "a".repeat(281), hashtags: [] }))).toBe(true);
  });

  it("normalises hashtags", () => {
    expect(normalizeHashtags(["#Smile", "smile", " dental care ", "##ok!", 3])).toEqual(["Smile", "dentalcare", "ok"]);
  });
});

describe("banned phrases", () => {
  it("matches whole words regardless of case, accents, quotes and spacing, including hashtags", () => {
    expect(findBannedPhrases("The CHEAPEST cleaning around", ["cheapest"])).toEqual(["cheapest"]);
    expect(findBannedPhrases("Enjoy the freedom", ["free"])).toEqual([]);
    expect(findBannedPhrases("Voted #BestInTown", ["best in town"])).toEqual(["best in town"]);
    expect(findBannedPhrases("Café   crème", ["cafe creme"])).toEqual(["cafe creme"]);
    expect(findBannedPhrases("We don’t judge", ["don't judge"])).toEqual(["don't judge"]);
  });

  it("scrubs only the offending sentences and hashtags", () => {
    const out = scrubBannedPhrases({ body: "Open Saturdays. We are the cheapest! Book now.", hashtags: ["cheapest", "smile"] }, ["cheapest"]);
    expect(out.body).toBe("Open Saturdays. Book now.");
    expect(out.hashtags).toEqual(["smile"]);
  });

  it("enforceHardLimits always produces a passing variant", () => {
    const v = enforceHardLimits("x", { body: "Cheapest care. " + "word ".repeat(80), hashtags: ["a", "b", "c", "d", "e"], linkUrl: "https://acme.example" }, ["cheapest"]);
    expect(hasErrors(checkVariant("x", v, ["cheapest"]))).toBe(false);
    const ig = enforceHardLimits("instagram", { body: "Book: https://acme.example/book", hashtags: [] }, []);
    expect(ig.body).toBe("Book: (link in bio)");
  });
});

describe("generateVariants (stubbed provider)", () => {
  beforeEach(() => {
    aiStructured.mockReset();
    logUsage.mockReset();
  });

  it("re-asks once for failing variants, then enforces limits: no banned phrase, nothing over the limit", async () => {
    aiStructured
      .mockResolvedValueOnce(
        reply([
          { platform: "facebook", body: "We now open on Saturdays, 9 to 2. Book a family visit!", hashtags: ["SaturdaySmiles"], imagePrompt: "Family at reception" },
          { platform: "instagram", body: "Saturdays are for smiles. Book at https://acme.example", hashtags: Array.from({ length: 35 }, (_, i) => `tag${i}`), imagePrompt: "Smiling kid" },
          { platform: "linkedin", body: "Acme Dental, the best in town, now opens on Saturdays.", hashtags: ["Healthcare"], imagePrompt: "Clinic" },
        ])
      )
      // The retry fixes LinkedIn but Instagram still slips a banned phrase in.
      .mockResolvedValueOnce(
        reply([
          { platform: "instagram", body: "Saturdays are for smiles, link in bio. The cheapest check-ups!", hashtags: ["SaturdaySmiles", "cheapest"], imagePrompt: "Smiling kid" },
          { platform: "linkedin", body: "We now open on Saturdays from 9 to 2, so working parents can book.", hashtags: ["Healthcare"], imagePrompt: "Clinic" },
        ])
      );

    const res = await generateVariants("biz1", ctx, {
      brief: "We now open on Saturdays 9-2",
      goal: "leads",
      platforms: ["facebook", "instagram", "linkedin"],
    });

    expect(aiStructured).toHaveBeenCalledTimes(2);
    const retryMessages = aiStructured.mock.calls[1][0] as { role: string; content: string }[];
    const retryAsk = retryMessages[retryMessages.length - 1].content;
    expect(retryAsk).toContain("instagram");
    expect(retryAsk).toContain("linkedin");
    expect(retryAsk).not.toContain("- facebook");
    expect(logUsage).toHaveBeenCalledTimes(2);
    expect(logUsage.mock.calls[0][1]).toBe("content_generate");

    expect(res.variants.map((v) => v.platform)).toEqual(["facebook", "instagram", "linkedin"]);
    for (const v of res.variants) {
      const text = composeText(v.platform, v);
      expect(findBannedPhrases(text, ctx.dontPhrases)).toEqual([]);
      expect(platformLength(v.platform, text)).toBeLessThanOrEqual(PLATFORM_RULES[v.platform].maxChars);
      expect(hasErrors(v.issues)).toBe(false);
    }
    expect(res.variants[1].body).toBe("Saturdays are for smiles, link in bio.");
    expect(res.variants[1].hashtags).toEqual(["SaturdaySmiles"]);
  });

  it("doesn't re-ask when everything passes, and drops the link where it isn't clickable", async () => {
    aiStructured.mockResolvedValueOnce(
      reply([
        { platform: "facebook", body: "Open Saturdays.", hashtags: [], imagePrompt: "" },
        { platform: "instagram", body: "Open Saturdays, link in bio.", hashtags: ["smile", "dentist", "family"], imagePrompt: "" },
      ])
    );
    const res = await generateVariants("biz1", ctx, { brief: "Saturdays", platforms: ["facebook", "instagram"], linkUrl: "https://acme.example" });
    expect(aiStructured).toHaveBeenCalledTimes(1);
    expect(res.variants[0].linkUrl).toBe("https://acme.example");
    expect(res.variants[1].linkUrl).toBeNull();
  });

  it("maps provider failures to a clean error and logs the failed call", async () => {
    aiStructured.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(generateVariants("biz1", ctx, { brief: "Saturdays", platforms: ["facebook"] })).rejects.toMatchObject({ status: 502 });
    expect(logUsage.mock.calls[0][3]).toBe("error");
  });

  it("puts the guardrails and platform rules in the system prompt", () => {
    const p = buildContentSystemPrompt(ctx, ["instagram", "x"]);
    expect(p).toContain("Never invent prices");
    expect(p).toContain("- cheapest");
    expect(p).toContain("- instagram (Instagram): max 2,200");
    expect(p).toContain("- x (X): max 280 characters including hashtags and the link");
    expect(p).toContain("Saturday 9-2");
    expect(p).not.toContain("linkedin (");
  });
});
