// OpenAI Chat Completions adapter for tenants who bring their own OpenAI key.
// Uses fetch rather than the openai package to avoid a second SDK dependency.

import type {
  AiStopReason,
  ProviderAdapter,
  ProviderCredentials,
  ProviderRequest,
  ProviderResponse,
} from "../types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 120_000;

/** Exported for unit tests. */
export function buildOpenAiBody(req: ProviderRequest, stream: boolean): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_completion_tokens: req.maxTokens,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "output", schema: req.jsonSchema, strict: true },
    };
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

async function post(creds: ProviderCredentials, body: Record<string, unknown>): Promise<Response> {
  if (!creds.apiKey) throw new Error("OpenAI provider requires an API key");
  const res = await fetch(`${creds.baseUrl || DEFAULT_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res;
}

export const openAiProvider: ProviderAdapter = {
  id: "openai",

  async chat(req, creds) {
    const res = await post(creds, buildOpenAiBody(req, false));
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
    const res = await post(creds, buildOpenAiBody(req, true));
    if (!res.body) throw new Error("OpenAI stream returned no body");

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
