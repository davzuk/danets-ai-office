import { describe, it, expect } from "vitest";
import { buildFormSchema, fieldProblem, normalizeFields, type FormField } from "@/lib/forms/schema";

describe("form schema", () => {
  const fields: FormField[] = [
    { key: "name", type: "text", label: "Name", required: true },
    { key: "email", type: "email", label: "Email", required: false, mapTo: "email" },
    { key: "plan", type: "select", label: "Plan", required: true, options: ["a", "b"] },
  ];

  it("rejects empty required fields and invalid emails", () => {
    const schema = buildFormSchema(fields);
    expect(() => schema.parse({ name: "  ", email: "x", plan: "a" })).toThrow();
  });

  it("accepts a valid submission and keeps optional empties", () => {
    const schema = buildFormSchema(fields);
    expect(schema.parse({ name: "Ada", email: "", plan: "a" })).toMatchObject({ name: "Ada", email: "", plan: "a" });
  });

  it("reports malformed fields instead of returning them", () => {
    const { fields: ok, problems } = normalizeFields([
      { key: "b@d", type: "text", label: "x" },
      { key: "a", type: "wat", label: "x" },
    ]);
    expect(ok).toHaveLength(0);
    expect(problems).toHaveLength(2);
  });

  it("requires options on select fields", () => {
    expect(fieldProblem({ key: "s", type: "select", label: "S" })).toMatch(/options/);
  });

  it("maps answers onto the lead profile", () => {
    const mapped = fields.filter((f) => f.mapTo);
    expect(mapped).toHaveLength(1);
  });
});