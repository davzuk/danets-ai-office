import { describe, expect, it } from "vitest";
import {
  RULE_MATCHER_JS,
  preChatFormSchema,
  readConditions,
  readPreChatForm,
  ruleConditionsSchema,
  toPublicRules,
  widgetRuleInputSchema,
} from "@/lib/widget-rules";

// The same source widget.js embeds, evaluated as the browser would.
const pickRule = new Function(`${RULE_MATCHER_JS}; return __dnPickRule;`)() as (
  rules: unknown[],
  ctx: { path: string; returning: boolean; device: "desktop" | "mobile"; capped?: (r: any) => boolean }
) => any;

const ctx = (over: Partial<Parameters<typeof pickRule>[1]> = {}) => ({ path: "/", returning: false, device: "desktop" as const, ...over });
const rule = (id: string, conditions: Record<string, unknown> = {}) => ({ id, conditions: { pages: [], visitor: "any", devices: ["desktop", "mobile"], ...conditions } });

describe("rule matcher (browser JS)", () => {
  it("matches every page when no pages are set", () => {
    expect(pickRule([rule("a")], ctx({ path: "/anything" }))?.id).toBe("a");
  });

  it("supports contains, prefix and equals, case-insensitively", () => {
    const contains = rule("c", { pages: [{ match: "contains", value: "Pricing" }] });
    const prefix = rule("p", { pages: [{ match: "prefix", value: "/blog" }] });
    const equals = rule("e", { pages: [{ match: "equals", value: "/contact/" }] });
    expect(pickRule([contains], ctx({ path: "/en/pricing-plans" }))?.id).toBe("c");
    expect(pickRule([prefix], ctx({ path: "/blog/post" }))?.id).toBe("p");
    expect(pickRule([prefix], ctx({ path: "/news/blog" }))).toBeNull();
    expect(pickRule([equals], ctx({ path: "/Contact" }))?.id).toBe("e");
    expect(pickRule([equals], ctx({ path: "/contact/us" }))).toBeNull();
  });

  it("treats '/' equals as the home page only", () => {
    const home = rule("h", { pages: [{ match: "equals", value: "/" }] });
    expect(pickRule([home], ctx({ path: "/" }))?.id).toBe("h");
    expect(pickRule([home], ctx({ path: "/about" }))).toBeNull();
  });

  it("filters by visitor type and device", () => {
    const fresh = rule("n", { visitor: "new" });
    const back = rule("r", { visitor: "returning" });
    const phone = rule("m", { devices: ["mobile"] });
    expect(pickRule([fresh, back], ctx({ returning: true }))?.id).toBe("r");
    expect(pickRule([fresh, back], ctx({ returning: false }))?.id).toBe("n");
    expect(pickRule([phone], ctx({ device: "desktop" }))).toBeNull();
    expect(pickRule([phone], ctx({ device: "mobile" }))?.id).toBe("m");
  });

  it("takes the first match in order and skips capped rules", () => {
    const rules = [rule("first"), rule("second")];
    expect(pickRule(rules, ctx())?.id).toBe("first");
    expect(pickRule(rules, ctx({ capped: (r) => r.id === "first" }))?.id).toBe("second");
    expect(pickRule([], ctx())).toBeNull();
  });
});

describe("rule schemas", () => {
  it("keeps only the setting the trigger uses, with defaults", () => {
    expect(ruleConditionsSchema.parse({ trigger: "time" })).toMatchObject({ seconds: 15, scrollPercent: undefined });
    expect(ruleConditionsSchema.parse({ trigger: "scroll", seconds: 30 })).toMatchObject({ seconds: undefined, scrollPercent: 50 });
    expect(ruleConditionsSchema.parse({ trigger: "exit", devices: ["mobile", "mobile"] }).devices).toEqual(["mobile"]);
  });

  it("rejects bad input", () => {
    expect(ruleConditionsSchema.safeParse({ devices: [] }).success).toBe(false);
    expect(ruleConditionsSchema.safeParse({ pages: [{ match: "regex", value: ".*" }] }).success).toBe(false);
    expect(widgetRuleInputSchema.safeParse({ name: "x", conditions: {}, message: "" }).success).toBe(false);
    expect(widgetRuleInputSchema.safeParse({ name: "x", conditions: {}, message: "hi", quickReplies: ["a", "b", "c", "d", "e"] }).success).toBe(false);
  });

  it("fills defaults for a minimal rule", () => {
    const r = widgetRuleInputSchema.parse({ name: " Nudge ", conditions: {}, message: " Hi " });
    expect(r).toMatchObject({ name: "Nudge", message: "Hi", enabled: true, priority: 0, action: "bubble", frequency: "session", quickReplies: [] });
  });

  it("reads a malformed stored row as null", () => {
    expect(readConditions({ trigger: "teleport" })).toBeNull();
    expect(readConditions("nope")).toBeNull();
  });
});

describe("toPublicRules", () => {
  const base = { enabled: true, priority: 0, conditions: {}, message: "Hi", quickReplies: null, action: "bubble", frequency: "session", createdAt: new Date("2026-01-01") };

  it("drops disabled and malformed rules and sorts by priority, then age", () => {
    const out = toPublicRules([
      { ...base, id: "old", createdAt: new Date("2026-01-01") },
      { ...base, id: "off", enabled: false, priority: 50 },
      { ...base, id: "bad", conditions: { trigger: "nope" }, priority: 40 },
      { ...base, id: "top", priority: 10 },
      { ...base, id: "new", createdAt: new Date("2026-02-01") },
    ]);
    expect(out.map((r) => r.id)).toEqual(["top", "old", "new"]);
  });

  it("normalises unknown action and frequency values and never leaks counters", () => {
    const [r] = toPublicRules([{ ...base, id: "x", action: "explode", frequency: "hourly", quickReplies: ["Yes", "", 3, "No"], shows: 9 } as any]);
    expect(r.action).toBe("bubble");
    expect(r.frequency).toBe("session");
    expect(r.quickReplies).toEqual(["Yes", "No"]);
    expect(r).not.toHaveProperty("shows");
  });
});

describe("pre-chat form", () => {
  it("is off unless enabled, and null when malformed", () => {
    expect(readPreChatForm(null)).toBeNull();
    expect(readPreChatForm({ enabled: false })).toBeNull();
    expect(readPreChatForm({ enabled: true, fields: { email: "maybe" } })).toBeNull();
  });

  it("fills field defaults and drops empty text", () => {
    expect(readPreChatForm({ enabled: true, intro: "", consentText: "  " })).toEqual({
      enabled: true,
      intro: undefined,
      consentText: undefined,
      fields: { email: "required", phone: "optional", company: "off" },
    });
  });

  it("requires an email or a phone when enabled", () => {
    const noContact = { enabled: true, fields: { email: "off", phone: "off", company: "required" } };
    expect(preChatFormSchema.safeParse(noContact).success).toBe(false);
    expect(preChatFormSchema.safeParse({ ...noContact, enabled: false }).success).toBe(true);
  });
});
