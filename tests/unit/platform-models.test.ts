import { describe, expect, it } from "vitest";
import {
  BUILTIN_MODELS,
  availableModels,
  normalizePlatformAi,
  parseModelKey,
  providerCredentials,
  resolveFromPlatform,
  type KeyedProvider,
} from "@/lib/llm/platform-models";

// "Encrypted" keys in these tests are { k: "..." }.
const decrypt = (p: unknown) => (p && typeof p === "object" && "k" in p ? String((p as { k: string }).k) : null);

const raw = {
  version: 2,
  providers: { alibaba: { apiKey: { k: "sk-ali" }, region: "singapore", workspaceId: "ws1" }, anthropic: { apiKey: "not-encrypted" } },
  models: [
    { provider: "alibaba", model: "qwen3.8-flash", label: "Flash", enabled: true, minPlan: "free" },
    { provider: "alibaba", model: "qwen4-max", label: "Max", enabled: true, minPlan: "pro" },
    { provider: "alibaba", model: "qwen-old", label: "Old", enabled: false, minPlan: "free" },
    { provider: "anthropic", model: "claude-opus-5-5", label: "Opus", enabled: true, minPlan: "free" },
    { provider: "openai", model: "gpt-x", label: "GPT", enabled: true, minPlan: "starter" },
    { provider: "alibaba", model: "qwen4-max", label: "Duplicate", enabled: true, minPlan: "free" },
    { provider: "nope", model: "x" },
  ],
  defaults: { classify: "alibaba:qwen3.8-flash", chat: "alibaba:qwen3.8-flash", plan: "bad" },
};

describe("normalizePlatformAi", () => {
  it("cleans the stored list and defaults", () => {
    const s = normalizePlatformAi(raw);
    expect(s.models.map((m) => `${m.provider}:${m.model}`)).toEqual([
      "alibaba:qwen3.8-flash",
      "alibaba:qwen4-max",
      "alibaba:qwen-old",
      "anthropic:claude-opus-5-5",
      "openai:gpt-x",
    ]);
    expect(s.defaults).toEqual({ classify: "alibaba:qwen3.8-flash", chat: "alibaba:qwen3.8-flash" });
  });

  it("falls back to the built-in list and reads the first Alibaba-only shape", () => {
    expect(normalizePlatformAi(null).models).toEqual(BUILTIN_MODELS);
    const old = normalizePlatformAi({ enabled: true, provider: "alibaba", region: "beijing", apiKey: { k: "sk-old" } });
    expect(old.providers.alibaba).toMatchObject({ region: "beijing", apiKey: { k: "sk-old" } });
  });

  it("parses model keys", () => {
    expect(parseModelKey("openai:gpt-5.5:latest")).toEqual({ provider: "openai", model: "gpt-5.5:latest" });
    expect(parseModelKey("zai:x")).toBeNull();
    expect(parseModelKey(":x")).toBeNull();
  });
});

describe("keys", () => {
  const s = normalizePlatformAi(raw);

  it("uses the stored key and region endpoint, then env", () => {
    expect(providerCredentials(s, "alibaba", {}, decrypt)).toEqual({ apiKey: "sk-ali", baseUrl: "https://ws1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" });
    // An undecryptable stored key doesn't count; env does.
    expect(providerCredentials(s, "anthropic", {}, decrypt)).toBeNull();
    expect(providerCredentials(s, "anthropic", { ANTHROPIC_API_KEY: "sk-env" }, decrypt)).toEqual({ apiKey: "sk-env", baseUrl: undefined });
    expect(providerCredentials(s, "openai", { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://x.openai.com/v1" }, decrypt)?.baseUrl).toBe("https://x.openai.com/v1");
  });

  it("offers enabled, keyed models the plan allows", () => {
    const has = (p: KeyedProvider) => p === "alibaba" || p === "openai";
    expect(availableModels(s, "free", has).map((m) => m.model)).toEqual(["qwen3.8-flash"]);
    expect(availableModels(s, "starter", has).map((m) => m.model)).toEqual(["qwen3.8-flash", "gpt-x"]);
    expect(availableModels(s, "pro", has).map((m) => m.model)).toEqual(["qwen3.8-flash", "qwen4-max", "gpt-x"]);
  });
});

describe("resolveFromPlatform", () => {
  const s = normalizePlatformAi(raw);
  const creds = (p: KeyedProvider) => providerCredentials(s, p, {}, decrypt);

  it("uses the tenant's model when its plan allows it", () => {
    const r = resolveFromPlatform("content", s, { plan: "pro", aiModel: "alibaba:qwen4-max" }, creds, { allowAuto: false });
    expect(r).toMatchObject({ provider: "alibaba", model: "qwen4-max", source: "tenant" });
  });

  it("keeps quick jobs on the platform default", () => {
    const r = resolveFromPlatform("classify", s, { plan: "pro", aiModel: "alibaba:qwen4-max" }, creds, { allowAuto: false });
    expect(r).toMatchObject({ model: "qwen3.8-flash", source: "platform" });
  });

  it("ignores a choice above the plan, turned off, or without a key", () => {
    for (const aiModel of ["alibaba:qwen4-max", "alibaba:qwen-old", "anthropic:claude-opus-5-5", "alibaba:unknown"]) {
      const r = resolveFromPlatform("chat", s, { plan: "free", aiModel }, creds, { allowAuto: false });
      expect(r).toMatchObject({ model: "qwen3.8-flash", source: "platform" });
    }
  });

  it("returns null with no default unless automatic is allowed", () => {
    expect(resolveFromPlatform("plan", s, null, creds, { allowAuto: false })).toBeNull();
    const auto = resolveFromPlatform("plan", s, null, creds, { allowAuto: true, storedKeys: ["alibaba"] });
    expect(auto).toMatchObject({ provider: "alibaba", model: "qwen4-max", source: "platform" });
  });
});
