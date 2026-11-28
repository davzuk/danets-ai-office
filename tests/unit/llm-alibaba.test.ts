import { afterEach, describe, expect, it, vi } from "vitest";
import { alibabaBaseUrl, alibabaProvider, ALIBABA_TASK_MODELS } from "@/lib/llm/providers/alibaba";
import { buildOpenAiBody } from "@/lib/llm/providers/openai";
import { parsePlatformAiConfig, resolvePlatformDefault, resolveTenant } from "@/lib/llm/resolve";
import type { ProviderRequest } from "@/lib/llm/types";

const req: ProviderRequest = {
  model: "qwen3.7-plus",
  task: "extract",
  system: "You are helpful.",
  messages: [{ role: "user", content: "Hi" }],
  maxTokens: 500,
  temperature: 0.3,
  jsonSchema: { type: "object", properties: { a: { type: "string" } } },
};

describe("Alibaba request body", () => {
  it("uses max_tokens and JSON-object mode with the schema in the system prompt", () => {
    const body = buildOpenAiBody(req, false, "alibaba") as any;
    expect(body.max_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    // Model Studio needs the word JSON in the messages for json_object.
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("You are helpful.\n\nRespond with a single JSON value");
    expect(body.messages[0].content).toContain('"properties":{"a":{"type":"string"}}');
    expect(body.temperature).toBe(0.3);
  });

  it("leaves plain requests alone and keeps OpenAI's body unchanged", () => {
    const plain = buildOpenAiBody({ ...req, jsonSchema: undefined, system: undefined }, true, "alibaba") as any;
    expect(plain.messages).toEqual([{ role: "user", content: "Hi" }]);
    expect(plain.response_format).toBeUndefined();
    expect(plain.stream_options).toEqual({ include_usage: true });
    const openai = buildOpenAiBody(req, false) as any;
    expect(openai.max_completion_tokens).toBe(500);
    expect(openai.response_format.type).toBe("json_schema");
    expect(openai.messages[0].content).toBe("You are helpful.");
  });
});

describe("Alibaba endpoints", () => {
  it("builds region and workspace URLs", () => {
    expect(alibabaBaseUrl("singapore")).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
    expect(alibabaBaseUrl("beijing")).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(alibabaBaseUrl("singapore", "WS-ab12")).toBe("https://ws-ab12.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
    expect(alibabaBaseUrl("us-virginia", "ws1")).toBe("https://ws1.us-east-1.maas.aliyuncs.com/compatible-mode/v1");
    // No shared domain in Virginia or Tokyo: a workspace ID is needed.
    expect(alibabaBaseUrl("us-virginia")).toBeNull();
    expect(alibabaBaseUrl("tokyo", "bad host/")).toBeNull();
  });
});

describe("Alibaba adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the region endpoint with a bearer key and maps the reply", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ model: "qwen3.8-flash", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await alibabaProvider.chat({ ...req, jsonSchema: undefined }, { apiKey: "sk-test", baseUrl: "https://ws1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/" });
    expect(res).toMatchObject({ content: "OK", model: "qwen3.8-flash", stopReason: "end", promptTokens: 12, totalTokens: 13 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ws1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("names Alibaba in errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Invalid API-key provided.", { status: 401 })));
    await expect(alibabaProvider.chat(req, { apiKey: "sk-x" })).rejects.toThrow("Alibaba Cloud request failed (401): Invalid API-key provided.");
    // A JSON error body is reduced to its message.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid API-key provided.", code: "invalid_api_key" } }), { status: 401 })));
    await expect(alibabaProvider.chat(req, { apiKey: "sk-x" })).rejects.toThrow(/\(401\): Invalid API-key provided\.$/);
  });
});

describe("Alibaba resolution", () => {
  const decrypt = (p: unknown) => (p && typeof p === "object" && "k" in p ? String((p as { k: string }).k) : null);

  it("reads the stored platform setting", () => {
    const cfg = parsePlatformAiConfig({ enabled: true, provider: "alibaba", region: "singapore", workspaceId: "ws1", models: { plan: " qwen-custom ", chat: "" }, apiKey: { k: "sk-a" } }, decrypt);
    expect(cfg).toEqual({ provider: "alibaba", apiKey: "sk-a", models: { plan: "qwen-custom" }, baseUrl: "https://ws1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" });
    const plan = resolveTenant("plan", cfg, "platform");
    expect(plan).toMatchObject({ provider: "alibaba", model: "qwen-custom", source: "platform" });
    expect(resolveTenant("chat", cfg, "platform")?.model).toBe(ALIBABA_TASK_MODELS.chat);
  });

  it("ignores it when off, keyless, or without a usable endpoint", () => {
    const base = { enabled: true, provider: "alibaba", region: "singapore", apiKey: { k: "sk-a" } };
    expect(parsePlatformAiConfig({ ...base, enabled: false }, decrypt)).toBeNull();
    expect(parsePlatformAiConfig({ ...base, apiKey: "garbage" }, decrypt)).toBeNull();
    expect(parsePlatformAiConfig({ ...base, region: "tokyo" }, decrypt)).toBeNull();
    expect(parsePlatformAiConfig({ ...base, provider: "openai" }, decrypt)).toBeNull();
    expect(parsePlatformAiConfig(null, decrypt)).toBeNull();
    // A custom base URL stands in for the workspace.
    expect(parsePlatformAiConfig({ ...base, region: "tokyo", baseUrl: "https://x.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1" }, decrypt)?.baseUrl).toContain("ap-northeast-1");
  });

  it("supports AI_DEFAULT_PROVIDER=alibaba from env", () => {
    const r = resolvePlatformDefault("classify", { AI_DEFAULT_PROVIDER: "alibaba", ALIBABA_API_KEY: "sk-env" });
    expect(r).toMatchObject({ provider: "alibaba", model: "qwen3.8-flash", credentials: { apiKey: "sk-env" } });
    expect(resolvePlatformDefault("chat", { AI_DEFAULT_PROVIDER: "alibaba" }).provider).toBe("zai");
  });
});
