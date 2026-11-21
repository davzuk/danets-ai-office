import Anthropic from "@anthropic-ai/sdk";
import { getModelInfo, TASK_EFFORT } from "../catalog";
import type {
  AiStopReason,
  ProviderAdapter,
  ProviderCredentials,
  ProviderRequest,
  ProviderResponse,
} from "../types";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const REQUEST_TIMEOUT_MS = 120_000;

// One client per credential set; the SDK keeps its own HTTP agent.
const clients = new Map<string, Anthropic>();

function getClient(creds: ProviderCredentials): Anthropic {
  const key = `${creds.apiKey ?? "env"}|${creds.baseUrl ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    if (clients.size > 100) clients.clear();
    client = new Anthropic({
      // undefined -> SDK resolves ANTHROPIC_API_KEY / profile from the environment
      apiKey: creds.apiKey || undefined,
      baseURL: creds.baseUrl || undefined,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 2,
    });
    clients.set(key, client);
  }
  return client;
}

/**
 * Build Messages API params. Exported for unit tests.
 *
 * Deliberately never sends `temperature` or `thinking: disabled`: current
 * Claude models reject both. Depth is controlled with effort instead.
 */
export function buildAnthropicParams(
  req: ProviderRequest
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const info = getModelInfo(req.model);

  const outputConfig: Anthropic.Beta.BetaOutputConfig = {};
  if (info?.supportsEffort) outputConfig.effort = TASK_EFFORT[req.task];
  if (req.jsonSchema) outputConfig.format = { type: "json_schema", schema: req.jsonSchema };

  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };

  if (req.system) {
    // Stable system prompt first, marked cacheable so repeat chat turns and
    // bulk generations reuse it.
    params.system = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
  }
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;
  if (info?.supportsFallbacks) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }
  return params;
}

function mapStopReason(reason: string | null | undefined): AiStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/** Convert a Messages API response into the provider-neutral shape. Exported for tests. */
export function toProviderResponse(message: Anthropic.Beta.BetaMessage): ProviderResponse {
  const content = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const u = message.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const promptTokens = u.input_tokens + cacheRead + cacheWrite;

  return {
    content,
    model: message.model,
    stopReason: mapStopReason(message.stop_reason),
    promptTokens,
    completionTokens: u.output_tokens,
    totalTokens: promptTokens + u.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

export const anthropicProvider: ProviderAdapter = {
  id: "anthropic",

  async chat(req, creds) {
    const message = await getClient(creds).beta.messages.create(buildAnthropicParams(req));
    return toProviderResponse(message);
  },

  async stream(req, creds, onText) {
    const stream = getClient(creds).beta.messages.stream(buildAnthropicParams(req));
    stream.on("text", (delta) => onText(delta));
    const message = await stream.finalMessage();
    return toProviderResponse(message);
  },
};
