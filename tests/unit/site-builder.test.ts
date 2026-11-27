import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { findPlaceholders, validateBlocks, SITE_BLOCK_KEYS, SITE_BLOCK_DEFS } = await import("@/lib/sites/blocks");
const { toPage, toSiteBlock, buildPageSystemPrompt, buildPageUserMessage, pageOutputSchema } = await import("@/lib/sites/ai");
const { toStructuredJsonSchema } = await import("@/lib/llm/schema");

const ctx = {
  businessName: "Acme Roofing",
  brandContext: "",
  dontPhrases: ["world-class"],
  facts: [{ title: "Services", content: "We repair flat roofs." }],
  profile: { industry: "Roofing", email: "hi@acme.test", phone: "0113 000", whatsapp: null },
  images: [{ id: "img1", url: "https://cdn.test/roof.jpg", description: "A roof" }],
};

const hero = (over: Record<string, unknown> = {}) => ({
  blockKey: "hero" as const,
  props: { eyebrow: "", title: "Roof repairs", subtitle: "Fast", primaryCtaLabel: "Get a quote", primaryCtaHref: "#form", secondaryCtaLabel: "", secondaryCtaHref: "javascript:alert(1)", imageId: "img1", align: "center" as const, ...over },
});
const faq = { blockKey: "faq" as const, props: { title: "FAQ", items: [{ question: "How fast?", answer: "Same week." }, { question: "", answer: "dropped" }] } };
const leadForm = { blockKey: "lead-form" as const, props: { title: "Get a quote", subtitle: "" } };
const magnet = { blockKey: "lead-magnet" as const, props: { title: "Free guide", subtitle: "" } };
const cta = { blockKey: "cta" as const, props: { title: "Ready?", subtitle: "", primaryCtaLabel: "Start", primaryCtaHref: "#form", secondaryCtaLabel: "", secondaryCtaHref: "" } };
const out = (blocks: unknown[]) => ({ title: "Roof repairs", slug: "roof-repairs", seoTitle: "Roof repairs", seoDescription: "", blocks }) as never;

describe("lead blocks", () => {
  it("exist in the editor and need a linked record", () => {
    expect(SITE_BLOCK_KEYS).toEqual(expect.arrayContaining(["lead-form", "lead-magnet"]));
    expect(SITE_BLOCK_DEFS["lead-form"].fields.some((f) => f.type === "form")).toBe(true);
    const { issues } = validateBlocks([
      { id: "a", blockKey: "lead-form", props: {} },
      { id: "b", blockKey: "lead-magnet", props: { magnetId: "cmagnet0000000001" } },
    ]);
    expect(issues.map((i) => [i.blockId, i.messages[0]])).toEqual([["a", "formId: Choose a form"]]);
  });
});

describe("placeholders", () => {
  it("finds [Add …] style markers anywhere in a block, with their path", () => {
    const found = findPlaceholders([
      { id: "t", blockKey: "testimonials", props: { items: [{ quote: "[Add a real customer testimonial]", author: "[add the customer's name]" }] } },
      { id: "h", blockKey: "hero", props: { title: "Since [Insert year founded]", subtitle: "[Not a placeholder]" } },
    ]);
    expect(found.map((p) => [p.blockId, p.path, p.text])).toEqual([
      ["t", "items.0.quote", "[Add a real customer testimonial]"],
      ["t", "items.0.author", "[add the customer's name]"],
      ["h", "title", "[Insert year founded]"],
    ]);
  });
});

describe("AI page mapping", () => {
  it("maps images by id, drops unsafe links and empty items", () => {
    const b = toSiteBlock(hero(), {}, new Map([["img1", "https://cdn.test/roof.jpg"]]), "x1")!;
    expect(b.props.imageUrl).toBe("https://cdn.test/roof.jpg");
    expect(b.props.primaryCtaHref).toBe("#form");
    expect(b.props).not.toHaveProperty("secondaryCtaHref");
    expect(b.props).not.toHaveProperty("eyebrow");
    const f = toSiteBlock(faq, {}, new Map(), "x2")!;
    expect(f.props.items).toHaveLength(1);
  });

  it("links the conversion block to the chosen record, never the model's", () => {
    const page = toPage(out([hero(), leadForm, magnet, faq]), { prompt: "p", goal: "leads" }, { formId: "cform00000000001" }, ctx.images);
    expect(page.blocks.map((b) => b.blockKey)).toEqual(["hero", "lead-form", "faq"]);
    expect(page.blocks[1].props.formId).toBe("cform00000000001");
    expect(validateBlocks(page.blocks).issues).toEqual([]);
  });

  it("adds the conversion block when the model leaves it out, before a closing CTA", () => {
    const page = toPage(out([hero(), faq, cta]), { prompt: "p", goal: "downloads" }, { magnetId: "cmagnet000000001" }, ctx.images);
    expect(page.blocks.map((b) => b.blockKey)).toEqual(["hero", "faq", "lead-magnet", "cta"]);
    const booking = toPage(out([hero(), faq]), { prompt: "p", goal: "bookings" }, { bookingTypeSlug: "survey" }, ctx.images);
    expect(booking.blocks.at(-1)).toMatchObject({ blockKey: "booking", props: { bookingTypeSlug: "survey" } });
  });

  it("keeps only one conversion block", () => {
    const page = toPage(out([hero(), leadForm, faq, leadForm]), { prompt: "p", goal: "leads" }, { formId: "cform00000000001" }, ctx.images);
    expect(page.blocks.filter((b) => b.blockKey === "lead-form")).toHaveLength(1);
  });

  it("refuses an empty result", () => {
    expect(() => toPage(out([hero({ title: "" })]), { prompt: "p", goal: "bookings" }, {}, ctx.images)).toThrow(/usable page/);
  });
});

describe("AI page prompt", () => {
  it("grounds the model and names the conversion target", () => {
    const sys = buildPageSystemPrompt(ctx);
    expect(sys).toContain("[Add");
    expect(sys).toContain("world-class");
    expect(sys).toContain("We repair flat roofs.");
    expect(sys).toContain("img1: A roof");
    const user = buildPageUserMessage({ prompt: "Emergency repairs", goal: "leads", offer: "Free inspection" }, { formId: "f", formName: "Quote form" });
    expect(user).toContain('the form "Quote form"');
    expect(user).toContain("#form");
    expect(user).toContain("Free inspection");
  });

  it("has a schema that strict structured outputs accept", () => {
    const schema = JSON.stringify(toStructuredJsonSchema(pageOutputSchema));
    expect(schema).not.toContain("oneOf");
    expect(schema).toContain("anyOf");
  });
});
