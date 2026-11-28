import { describe, expect, it } from "vitest";
import { z } from "zod";
import { computeCostUsd } from "@/lib/llm/catalog";
import { normalizeMessages } from "@/lib/llm/messages";
import { extractJson, toStructuredJsonSchema } from "@/lib/llm/schema";
import { resolvePlatformDefault } from "@/lib/llm/resolve";
import { buildAnthropicParams, toProviderResponse } from "@/lib/llm/providers/anthropic";
import { buildOpenAiBody } from "@/lib/llm/providers/openai";
import type { ProviderRequest } from "@/lib/llm/types";

const baseReq: ProviderRequest = {
  model: "claude-opus-5-5",
  task: "chat",
  system: "You are helpful.",
  messages: [{ role: "user", content: "Hi" }],
  maxTokens: 1000,
  temperature: 0.4,
};

describe("computeCostUsd", () => {
  it("prices Opus 5.5 input and output per 1M tokens", () => {
    const cost = computeCostUsd("anthropic", "claude-opus-5-5", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(24, 6); // $4 in + $20 out
  });

  it("prices cache reads and writes separately from fresh input", () => {
    const cost = computeCostUsd("anthropic", "claude-opus-5-5", {
      promptTokens: 1_000_000, // 600k fresh + 300k read + 100k write
      completionTokens: 0,
      totalTokens: 1_000_000,
      cacheReadTokens: 300_000,
      cacheWriteTokens: 100_000,
    });
    // 0.6*4 + 0.3*0.2 + 0.1*4*1.25 = 2.4 + 0.06 + 0.5
    expect(cost).toBeCloseTo(2.96, 6);
  });

  it("keeps the legacy flat rate for z-ai", () => {
    expect(
      computeCostUsd("zai", "zai-default", { promptTokens: 500, completionTokens: 500, totalTokens: 1000 })
    ).toBeCloseTo(0.002, 9);
  });

  it("charges 0 for unknown models instead of guessing", () => {
    expect(
      computeCostUsd("openai", "some-model", { promptTokens: 10, completionTokens: 10, totalTokens: 20 })
    ).toBe(0);
  });
});

describe("normalizeMessages", () => {
  it("hoists and joins system messages", () => {
    const out = normalizeMessages([
      { role: "system", content: "A" },
      { role: "user", content: "hello" },
      { role: "system", content: "B" },
    ]);
    expect(out.system).toBe("A\n\nB");
    expect(out.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("drops empty turns and starts with a user turn", () => {
    const out = normalizeMessages([
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "   " },
      { role: "user", content: "Pricing?" },
    ]);
    expect(out.messages[0].role).toBe("user");
    expect(out.messages.map((m) => m.content)).toEqual([
      "(Conversation started.)",
      "Hi! How can I help?",
      "Pricing?",
    ]);
  });
});

describe("structured output schema", () => {
  it("strips unsupported constraints and closes objects", () => {
    const schema = toStructuredJsonSchema(
      z.object({
        score: z.number().min(0).max(100),
        tags: z.array(z.object({ name: z.string().min(1) })).max(5),
      })
    ) as any;
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.score.minimum).toBeUndefined();
    expect(schema.properties.score.maximum).toBeUndefined();
    expect(schema.properties.tags.maxItems).toBeUndefined();
    expect(schema.properties.tags.items.additionalProperties).toBe(false);
    expect(schema.properties.tags.items.properties.name.minLength).toBeUndefined();
  });

  it("extracts JSON from fenced or chatty output", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure!\n```json\n{"a": {"b": 2}}\n```')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("resolvePlatformDefault", () => {
  it("uses Anthropic Opus 5.5 when ANTHROPIC_API_KEY is set", () => {
    const r = resolvePlatformDefault("chat", { ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", source: "platform" });
    expect(r.credentials.apiKey).toBe("sk-ant-x");
  });

  it("falls back to z-ai when nothing is configured", () => {
    expect(resolvePlatformDefault("chat", {}).provider).toBe("zai");
  });

  it("honours per-task and global model overrides", () => {
    const env = { ANTHROPIC_API_KEY: "k", AI_DEFAULT_MODEL: "claude-sonnet-5-5", AI_MODEL_CLASSIFY: "claude-haiku-5-5" };
    expect(resolvePlatformDefault("chat", env).model).toBe("claude-sonnet-5-5");
    expect(resolvePlatformDefault("classify", env).model).toBe("claude-haiku-5-5");
  });

  it("does not pick a misconfigured OpenAI default", () => {
    expect(resolvePlatformDefault("chat", { AI_DEFAULT_PROVIDER: "openai", OPENAI_API_KEY: "k" }).provider).toBe("zai");
    expect(
      resolvePlatformDefault("chat", { AI_DEFAULT_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_DEFAULT_MODEL: "m" })
    ).toMatchObject({ provider: "openai", model: "m" });
  });
});

describe("Anthropic adapter", () => {
  it("never sends temperature or disabled thinking", () => {
    const params = buildAnthropicParams(baseReq) as any;
    expect(params.temperature).toBeUndefined();
    expect(params.thinking).toBeUndefined();
  });

  it("sets effort per task, cacheable system prompt and refusal fallbacks", () => {
    const params = buildAnthropicParams({ ...baseReq, task: "plan" }) as any;
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.system[0]).toMatchObject({ text: "You are helpful.", cache_control: { type: "ephemeral" } });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("adds a json_schema format for structured output", () => {
    const schema = { type: "object", properties: {}, additionalProperties: false };
    const params = buildAnthropicParams({ ...baseReq, jsonSchema: schema }) as any;
    expect(params.output_config.format).toEqual({ type: "json_schema", schema });
  });

  it("omits optional features for models outside the catalog", () => {
    const params = buildAnthropicParams({ ...baseReq, model: "claude-custom" }) as any;
    expect(params.output_config).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
    expect(params.betas).toBeUndefined();
  });

  it("does not request fallbacks for Haiku 5.5", () => {
    const params = buildAnthropicParams({ ...baseReq, model: "claude-haiku-5-5" }) as any;
    expect(params.fallbacks).toBeUndefined();
    expect(params.output_config).toEqual({ effort: "low" });
  });

  it("maps usage, text blocks and stop reasons", () => {
    const res = toProviderResponse({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "", signature: "x" },
        { type: "text", text: "Hello " },
        { type: "text", text: "there" },
      ],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
    } as any);
    expect(res).toMatchObject({
      content: "Hello there",
      stopReason: "end",
      promptTokens: 160,
      completionTokens: 20,
      totalTokens: 180,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    });
    expect(
      toProviderResponse({ model: "m", stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } } as any)
        .stopReason
    ).toBe("refusal");
  });
});

describe("OpenAI adapter", () => {
  it("keeps temperature and maps structured output to response_format", () => {
    const body = buildOpenAiBody({ ...baseReq, model: "m", jsonSchema: { type: "object" } }, false) as any;
    expect(body.temperature).toBe(0.4);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(body.response_format.json_schema).toMatchObject({ strict: true, schema: { type: "object" } });
    expect(body.stream).toBeUndefined();
    expect(buildOpenAiBody(baseReq, true).stream).toBe(true);
  });
});
