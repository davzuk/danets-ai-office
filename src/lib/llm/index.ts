import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { computeCostUsd } from "./catalog";
import { normalizeMessages } from "./messages";
import { anthropicProvider } from "./providers/anthropic";
import { openAiProvider } from "./providers/openai";
import { zaiProvider } from "./providers/zai";
import { resolveProvider } from "./resolve";
import { extractJson, toStructuredJsonSchema } from "./schema";
import {
  AiOutputParseError,
  AiRefusalError,
  type AiCallOptions,
  type AiMessage,
  type AiResult,
  type ProviderAdapter,
  type ProviderId,
  type ProviderRequest,
} from "./types";

export * from "./types";
export { clearAiProviderCache } from "./resolve";

const DEFAULT_MAX_TOKENS = 16_000;

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicProvider,
  openai: openAiProvider,
  zai: zaiProvider,
};

async function prepare(messages: AiMessage[], opts: AiCallOptions, jsonSchema?: Record<string, unknown>) {
  const task = opts.task ?? "chat";
  const resolved = await resolveProvider(opts.businessId, task);
  const { system, messages: turns } = normalizeMessages(messages);
  const req: ProviderRequest = {
    model: resolved.model,
    task,
    system,
    messages: turns,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature,
    jsonSchema,
  };
  return { resolved, req, adapter: ADAPTERS[resolved.provider] };
}

function finish(
  provider: ProviderId,
  res: Awaited<ReturnType<ProviderAdapter["chat"]>>,
  startedAt: number
): AiResult {
  const result: AiResult = { ...res, provider, latencyMs: Date.now() - startedAt };
  if (result.stopReason === "refusal") throw new AiRefusalError(provider, result.model);
  if (result.stopReason === "max_tokens") {
    logger.warn("AI response hit max_tokens", { provider, model: result.model });
  }
  return result;
}

/** Single completion. Throws AiRefusalError when the model declines. */
export async function aiChat(messages: AiMessage[], opts: AiCallOptions = {}): Promise<AiResult> {
  const { resolved, req, adapter } = await prepare(messages, opts);
  const startedAt = Date.now();
  const res = await adapter.chat(req, resolved.credentials);
  return finish(resolved.provider, res, startedAt);
}

/** Streaming completion: text deltas go to `onText`, the full result is returned. */
export async function aiStream(
  messages: AiMessage[],
  onText: (delta: string) => void,
  opts: AiCallOptions = {}
): Promise<AiResult> {
  const { resolved, req, adapter } = await prepare(messages, opts);
  const startedAt = Date.now();
  const res = await adapter.stream(req, resolved.credentials, onText);
  return finish(resolved.provider, res, startedAt);
}

/**
 * Completion constrained to a Zod schema. Anthropic and OpenAI enforce the
 * schema server-side; z-ai is instructed and validated here. The parsed value
 * is always re-validated with Zod (constraints like min/max are checked only
 * client-side).
 */
export async function aiStructured<S extends z.ZodType>(
  messages: AiMessage[],
  schema: S,
  opts: AiCallOptions = {}
): Promise<AiResult & { data: z.infer<S> }> {
  const { resolved, req, adapter } = await prepare(
    messages,
    { task: "extract", ...opts },
    toStructuredJsonSchema(schema)
  );
  const startedAt = Date.now();
  const res = await adapter.chat(req, resolved.credentials);
  const result = finish(resolved.provider, res, startedAt);

  let raw: unknown;
  try {
    raw = extractJson(result.content);
  } catch (e) {
    throw new AiOutputParseError(`Model output was not JSON: ${(e as Error).message}`, result.content);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AiOutputParseError(`Model output did not match schema: ${parsed.error.message}`, result.content);
  }
  return { ...result, data: parsed.data };
}

/** Token counts accepted by logUsage; provider/model enable per-model pricing. */
export interface UsageInput {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  provider?: ProviderId;
  model?: string;
  latencyMs?: number;
}

export const EMPTY_USAGE: UsageInput = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Record one AI call in AiUsageLog. Never throws. */
export async function logUsage(
  businessId: string,
  feature: string,
  usage: UsageInput,
  status: "success" | "error" = "success",
  error?: string
): Promise<void> {
  const provider = usage.provider ?? "zai";
  try {
    await db.aiUsageLog.create({
      data: {
        businessId,
        feature,
        provider,
        model: usage.model ?? null,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        latencyMs: usage.latencyMs ?? null,
        costUsd: computeCostUsd(provider, usage.model, usage),
        status,
        error: error?.slice(0, 1000),
      },
    });
  } catch (e) {
    logger.warn("logUsage failed", { businessId, feature, ...serializeError(e) });
  }
}
