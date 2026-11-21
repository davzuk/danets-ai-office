import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { LIMIT_FIELDS, formatLimit, pickLimits } from "@/lib/limit-fields";
import { listModuleFlags } from "@/lib/module-registry";

const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
const modelBody = (name: string) => schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
const limitColumns = (name: string) => [...modelBody(name).matchAll(/^\s+(\w+Limit)\s+Int/gm)].map((m) => m[1]).sort();

describe("LIMIT_FIELDS", () => {
  it("covers every *Limit column on plans and tenant overrides", () => {
    const keys = LIMIT_FIELDS.map((f) => f.key).sort();
    expect(limitColumns("SubscriptionPlan")).toEqual(keys);
    expect(limitColumns("BusinessLimitOverride")).toEqual(keys);
  });

  it("uses the schema defaults as fallbacks", () => {
    const body = modelBody("SubscriptionPlan");
    for (const f of LIMIT_FIELDS) {
      const def = body.match(new RegExp(`\\s${f.key}\\s+Int\\s+@default\\((\\d+)\\)`))?.[1];
      expect(Number(def), f.key).toBe(f.fallback);
    }
  });

  it("picks values and formats them", () => {
    expect(pickLimits({ chatLimit: 5 }, true).leadLimit).toBe(50);
    expect(pickLimits({ chatLimit: 5 }, false)).toMatchObject({ chatLimit: 5, leadLimit: null });
    expect(formatLimit(0, "/mo")).toBe("Unlimited");
    expect(formatLimit(10240, "MB")).toBe("10 GB");
    expect(formatLimit(250, "MB")).toBe("250 MB");
  });
});

describe("listModuleFlags", () => {
  it("lists the flag behind each gated module", () => {
    expect(listModuleFlags()).toContainEqual({ flagKey: "social_hub", module: "social", label: "Social Media", minPlan: "starter" });
    expect(listModuleFlags().every((m) => /^[a-z][a-z0-9_]*$/.test(m.flagKey))).toBe(true);
  });
});
