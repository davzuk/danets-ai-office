// Decide which provider, model and credentials serve a call.
//
// Order: the tenant's active `ai_provider` integration (with a usable key)
// -> platform default from env -> legacy z-ai.

import { ANTHROPIC_TASK_MODELS } from "./catalog";
import type { AiTask, ProviderId, ResolvedProvider } from "./types";

export interface AiIntegrationRow {
  provider: string;
  status: string;
  config: string | null;
}

export interface TenantAiConfig {
  provider: ProviderId;
  apiKey?: string;
  model?: string;
  models?: Partial<Record<AiTask, string>>;
  baseUrl?: string;
}

type Env = Record<string, string | undefined>;

const ZAI_MODEL = "zai-default";

function isProviderId(v: unknown): v is ProviderId {
  return v === "anthropic" || v === "openai" || v === "zai";
}

function pickModel(
  task: AiTask,
  explicit: { model?: string; models?: Partial<Record<AiTask, string>> },
  fallback: string | undefined
): string | undefined {
  return explicit.models?.[task] || explicit.model || fallback;
}

/** Platform-level default, from environment variables. Pure; exported for tests. */
export function resolvePlatformDefault(task: AiTask, env: Env): ResolvedProvider {
  const configured = env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  const provider: ProviderId = isProviderId(configured)
    ? configured
    : env.ANTHROPIC_API_KEY
      ? "anthropic"
      : "zai";

  const perTask = env[`AI_MODEL_${task.toUpperCase()}`];
  const overrides = { model: perTask || env.AI_DEFAULT_MODEL };

  if (provider === "anthropic") {
    return {
      provider,
      model: pickModel(task, overrides, ANTHROPIC_TASK_MODELS[task])!,
      credentials: { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL },
      source: "platform",
    };
  }
  if (provider === "openai") {
    const model = pickModel(task, overrides, env.OPENAI_DEFAULT_MODEL);
    if (env.OPENAI_API_KEY && model) {
      return {
        provider,
        model,
        credentials: { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL },
        source: "platform",
      };
    }
    // Misconfigured OpenAI default: fall through to z-ai rather than fail every call.
  }
  return { provider: "zai", model: ZAI_MODEL, credentials: {}, source: "platform" };
}

/**
 * Tenant override, or null when the tenant has nothing usable configured.
 * Pure; exported for tests.
 */
export function resolveTenant(task: AiTask, cfg: TenantAiConfig | null): ResolvedProvider | null {
  if (!cfg) return null;
  if (cfg.provider === "zai") {
    return { provider: "zai", model: ZAI_MODEL, credentials: {}, source: "tenant" };
  }
  if (!cfg.apiKey) return null;

  if (cfg.provider === "anthropic") {
    return {
      provider: "anthropic",
      model: pickModel(task, cfg, ANTHROPIC_TASK_MODELS[task])!,
      credentials: { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl },
      source: "tenant",
    };
  }
  // OpenAI has no safe built-in default model; require the tenant to pick one.
  const model = pickModel(task, cfg, undefined);
  if (!model) return null;
  return {
    provider: "openai",
    model,
    credentials: { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl },
    source: "tenant",
  };
}

/**
 * Turn a stored Integration row into a TenantAiConfig. `decrypt` is injected
 * so this stays testable without the crypto key.
 */
export function parseTenantAiConfig(
  row: AiIntegrationRow | null,
  decrypt: (payload: unknown) => string | null
): TenantAiConfig | null {
  if (!row || row.status !== "active" || !isProviderId(row.provider)) return null;

  let config: Record<string, unknown> = {};
  try {
    config = row.config ? JSON.parse(row.config) : {};
  } catch {
    return null;
  }

  const rawKey = config.apiKey;
  const apiKey =
    typeof rawKey === "string" && rawKey.length > 0 ? rawKey : decrypt(rawKey) ?? undefined;

  const models: Partial<Record<AiTask, string>> = {};
  if (config.models && typeof config.models === "object") {
    for (const [k, v] of Object.entries(config.models as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) models[k as AiTask] = v.trim();
    }
  }

  return {
    provider: row.provider,
    apiKey,
    model: typeof config.model === "string" && config.model.trim() ? config.model.trim() : undefined,
    models,
    baseUrl: typeof config.baseUrl === "string" && config.baseUrl ? config.baseUrl : undefined,
  };
}

// ─── DB-backed resolver with a short cache ─────────────────────────────

const CACHE_TTL_MS = 60_000;
const tenantCache = new Map<string, { at: number; cfg: TenantAiConfig | null }>();

/** Call after an ai_provider integration is created, updated or deleted. */
export function clearAiProviderCache(businessId?: string) {
  if (businessId) tenantCache.delete(businessId);
  else tenantCache.clear();
}

async function loadTenantConfig(businessId: string): Promise<TenantAiConfig | null> {
  const hit = tenantCache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cfg;

  const [{ db }, { decryptApiKey }] = await Promise.all([import("@/lib/db"), import("@/lib/crypto")]);
  const row = await db.integration.findFirst({
    where: { businessId, category: "ai_provider", status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { provider: true, status: true, config: true },
  });
  const cfg = parseTenantAiConfig(row, decryptApiKey);
  tenantCache.set(businessId, { at: Date.now(), cfg });
  return cfg;
}

export async function resolveProvider(
  businessId: string | undefined,
  task: AiTask
): Promise<ResolvedProvider> {
  if (businessId) {
    const tenant = resolveTenant(task, await loadTenantConfig(businessId));
    if (tenant) return tenant;
  }
  return resolvePlatformDefault(task, process.env);
}
