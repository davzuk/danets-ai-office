// Model catalog: prices and per-model request capabilities.
//
// Prices are USD per 1M tokens. Anthropic first-party rates as of 2026-11.
// Cache writes are billed at 1.25x the input rate (5-minute TTL).
// Unknown models cost 0 and get no optional request features, so a tenant
// override to an unlisted model degrades safely instead of erroring.

import type { AiTask, AiUsage, ProviderId } from "./types";

export interface ModelInfo {
  provider: ProviderId;
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  /** Accepts output_config.effort. */
  supportsEffort: boolean;
  /** Accepts server-side `fallbacks: "default"` on refusal. */
  supportsFallbacks: boolean;
}

export const MODEL_CATALOG: Record<string, ModelInfo> = {
  "claude-opus-5-5": {
    provider: "anthropic",
    inputPerM: 4,
    outputPerM: 20,
    cacheReadPerM: 0.2,
    supportsEffort: true,
    supportsFallbacks: true,
  },
  "claude-sonnet-5-5": {
    provider: "anthropic",
    inputPerM: 2,
    outputPerM: 10,
    cacheReadPerM: 0.1,
    supportsEffort: true,
    supportsFallbacks: true,
  },
  "claude-haiku-5-5": {
    provider: "anthropic",
    inputPerM: 0.1,
    outputPerM: 0.5,
    cacheReadPerM: 0.01,
    supportsEffort: true,
    // Haiku 5.5 has no server-side refusal fallback.
    supportsFallbacks: false,
  },
};

/** Legacy flat rate used before per-model pricing (z-ai and unknown models). */
const LEGACY_RATE_PER_1K = 0.002;

export function getModelInfo(model: string): ModelInfo | undefined {
  return MODEL_CATALOG[model];
}

/** Cost in USD for one call. */
export function computeCostUsd(
  provider: ProviderId,
  model: string | undefined,
  usage: Pick<AiUsage, "promptTokens" | "completionTokens" | "totalTokens"> &
    Partial<Pick<AiUsage, "cacheReadTokens" | "cacheWriteTokens">>
): number {
  const info = model ? getModelInfo(model) : undefined;
  if (!info) {
    // z-ai keeps the historical estimate so existing usage charts stay comparable.
    return provider === "zai" ? (usage.totalTokens / 1000) * LEGACY_RATE_PER_1K : 0;
  }
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncachedInput = Math.max(0, usage.promptTokens - cacheRead - cacheWrite);
  const cost =
    (uncachedInput * info.inputPerM +
      cacheWrite * info.inputPerM * 1.25 +
      cacheRead * info.cacheReadPerM +
      usage.completionTokens * info.outputPerM) /
    1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}

/** Default model per task for the Anthropic provider. */
export const ANTHROPIC_TASK_MODELS: Record<AiTask, string> = {
  chat: "claude-opus-5-5",
  classify: "claude-opus-5-5",
  extract: "claude-opus-5-5",
  content: "claude-opus-5-5",
  plan: "claude-opus-5-5",
};

/** Effort per task (Anthropic output_config.effort). */
export const TASK_EFFORT: Record<AiTask, "low" | "medium" | "high"> = {
  chat: "low",
  classify: "low",
  extract: "low",
  content: "medium",
  plan: "high",
};
