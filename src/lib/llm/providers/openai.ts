// OpenAI Chat Completions adapter for tenants who bring their own OpenAI key,
// and the base for other OpenAI-compatible APIs (Alibaba Cloud Model Studio).
// Uses fetch rather than the openai package to avoid a second SDK dependency.

import type {
  AiStopReason,
  ProviderAdapter,
  ProviderCredentials,
  ProviderId,
  ProviderRequest,
  ProviderResponse,
} from "../types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * How a compatible API differs from OpenAI's:
 * - "openai": `max_completion_tokens` and strict `json_schema` output.
 * - "alibaba": `max_tokens`, and `json_object` output with the schema in the
 *   system prompt (Model Studio enforces json_schema on only a few models, and
 *   json_object needs the word "JSON" in the messages). Zod re-validates.
 */
export type OpenAiDialect = "openai" | "alibaba";

/** Exported for unit tests. */
export function buildOpenAiBody(req: ProviderRequest, stream: boolean, dialect: OpenAiDialect = "openai"): Record<string, unknown> {
  let system = req.system ?? "";
  if (req.jsonSchema && dialect === "alibaba") {
    system +=
      `${system ? "\n\n" : ""}Respond with a single JSON value matching this JSON schema, ` +
      `and nothing else (no markdown fences, no commentary):\n${JSON.stringify(req.jsonSchema)}`;
  }
  const messages: { role: string; content: string }[] = [];
  if (system) messages.push({ role: "system", content: system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = { model: req.model, messages };
  if (dialect === "alibaba") body.max_tokens = req.maxTokens;
  else body.max_completion_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.jsonSchema) {
    body.response_format =
      dialect === "alibaba"
        ? { type: "json_object" }
        : { type: "json_schema", json_schema: { name: "output", schema: req.jsonSchema, strict: true } };
  }
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

function mapFinishReason(reason: string | null | undefined): AiStopReason {
  if (reason === "stop") return "end";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  return "other";
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

function usageFields(u: OpenAiUsage | undefined) {
  const promptTokens = u?.prompt_tokens ?? 0;
  const completionTokens = u?.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: u?.total_tokens ?? promptTokens + completionTokens,
    cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  };
}

interface CompatibleOptions {
  id: ProviderId;
  /** Shown in errors, e.g. "OpenAI" or "Alibaba Cloud". */
  label: string;
  defaultBaseUrl: string;
  dialect: OpenAiDialect;
}

async function post(o: CompatibleOptions, creds: ProviderCredentials, body: Record<string, unknown>): Promise<Response> {
  if (!creds.apiKey) throw new Error(`${o.label} provider requires an API key`);
  const base = (creds.baseUrl || o.defaultBaseUrl).replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${o.label} request failed (${res.status}): ${errorDetail(await res.text().catch(() => ""))}`);
  }
  return res;
}

/** The message from an `{ error: { message } }` body, else the raw text. Exported for tests. */
export function errorDetail(text: string): string {
  try {
    const msg = (JSON.parse(text) as { error?: { message?: unknown } })?.error?.message;
    if (typeof msg === "string" && msg) return msg.slice(0, 300);
  } catch {
    // not JSON
  }
  return text.slice(0, 300);
}

/** An adapter for any OpenAI-compatible Chat Completions API. */
export function createOpenAiCompatible(o: CompatibleOptions): ProviderAdapter {
  return {
  id: o.id,

  async chat(req, creds) {
    const res = await post(o, creds, buildOpenAiBody(req, false, o.dialect));
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      usage?: OpenAiUsage;
    };
    const choice = json.choices?.[0];
    const refused = !!choice?.message?.refusal;
    return {
      content: refused ? "" : choice?.message?.content ?? "",
      model: json.model || req.model,
      stopReason: refused ? "refusal" : mapFinishReason(choice?.finish_reason),
      ...usageFields(json.usage),
    };
  },

  async stream(req, creds, onText) {
    const res = await post(o, creds, buildOpenAiBody(req, true, o.dialect));
    if (!res.body) throw new Error(`${o.label} stream returned no body`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let model = req.model;
    let finish: string | undefined;
    let usage: OpenAiUsage | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data:")) continue;
        const payload = data.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.model) model = evt.model;
          if (evt.usage) usage = evt.usage;
          const choice = evt.choices?.[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const delta: string | undefined = choice?.delta?.content;
          if (delta) {
            content += delta;
            onText(delta);
          }
        } catch {
          // ignore keep-alive or partial lines
        }
      }
    }

    return { content, model, stopReason: mapFinishReason(finish), ...usageFields(usage) };
  },
  };
}

export const openAiProvider = createOpenAiCompatible({ id: "openai", label: "OpenAI", defaultBaseUrl: DEFAULT_BASE_URL, dialect: "openai" });
