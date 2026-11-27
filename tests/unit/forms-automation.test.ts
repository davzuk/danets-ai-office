import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { triggerConfigMatches } = await import("@/lib/automation");
const { buildFormSchema, mapProfile } = await import("@/lib/forms/schema");

describe("form_submitted workflows", () => {
  const ctx = { businessId: "b1", leadId: "l1", formId: "f1" };

  it("runs for any form when no form is chosen", () => {
    expect(triggerConfigMatches("form_submitted", {}, ctx)).toBe(true);
    expect(triggerConfigMatches("form_submitted", { formId: "" }, ctx)).toBe(true);
  });

  it("runs only for the chosen form", () => {
    expect(triggerConfigMatches("form_submitted", { formId: "f1", formName: "Quote" }, ctx)).toBe(true);
    expect(triggerConfigMatches("form_submitted", { formId: "f2" }, ctx)).toBe(false);
  });

  it("leaves other triggers alone", () => {
    expect(triggerConfigMatches("new_lead", { formId: "f2" }, ctx)).toBe(true);
  });
});

describe("checkbox answers", () => {
  it("accepts the joined choices the renderers send and maps text fields only", () => {
    const fields = [
      { key: "email", type: "email" as const, label: "Email", required: true, mapTo: "email" as const },
      { key: "topics", type: "checkbox" as const, label: "Topics", required: true, options: ["A", "B"] },
    ];
    const answers = buildFormSchema(fields).parse({ email: "ada@example.com", topics: "A, B" });
    expect(answers).toMatchObject({ topics: "A, B" });
    expect(() => buildFormSchema(fields).parse({ email: "ada@example.com", topics: "" })).toThrow();
    expect(mapProfile(fields, answers)).toEqual({ email: "ada@example.com" });
  });
});
