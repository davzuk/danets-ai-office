// The platform owns every AI key. Platform admins keep a key per provider
// (Platform settings → AI, or env) and a list of models, each with a minimum
// plan. A tenant picks one model from that list; quick background jobs
// (the "classify" task) always use the platform's own default.
//
// Pure: no DB or crypto here, so it is safe in unit tests. Decryption and the
// tenant's plan and choice are passed in.

import { planRank } from "@/lib/module-registry";
import { ANTHROPIC_TASK_MODELS } from "./catalog";
import { ALIBABA_TASK_MODELS, alibabaBaseUrl, isAlibabaRegion } from "./providers/alibaba";
import { AI_TASKS, type AiTask, type ProviderCredentials, type ProviderId, type ResolvedProvider } from "./types";

/** Providers the platform can hold a key for (z-ai needs none). */
export const KEYED_PROVIDERS = ["anthropic", "openai", "alibaba"] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<KeyedProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  alibaba: "Alibaba Cloud (Qwen)",
};

export function isKeyedProvider(v: unknown): v is KeyedProvider {
  return v === "anthropic" || v === "openai" || v === "alibaba";
}

export const MODEL_PLANS = ["free", "starter", "pro", "enterprise"] as const;
export type ModelPlan = (typeof MODEL_PLANS)[number];

export interface PlatformModel {
  provider: KeyedProvider;
  /** The provider's model id, e.g. "qwen3.7-plus". */
  model: string;
  label: string;
  enabled: boolean;
  /** Lowest plan that may pick it. */
  minPlan: ModelPlan;
}

/** Stored per provider. `apiKey` is an encrypted payload. */
export interface StoredProvider {
  apiKey?: unknown;
  baseUrl?: string | null;
  /** Alibaba only. */
  region?: string;
  workspaceId?: string | null;
}

/** PlatformConfig.aiConfig. */
export interface StoredPlatformAi {
  version?: number;
  providers?: Partial<Record<KeyedProvider, StoredProvider>>;
  models?: PlatformModel[];
  /** Model key ("provider:model") per task; missing = automatic. */
  defaults?: Partial<Record<AiTask, string>>;
  updatedBy?: string;
  updatedAt?: string;
}

export interface PlatformAiState {
  providers: Partial<Record<KeyedProvider, StoredProvider>>;
  models: PlatformModel[];
  defaults: Partial<Record<AiTask, string>>;
}

/** Models offered until an admin edits the list. OpenAI models are added by name. */
export const BUILTIN_MODELS: PlatformModel[] = [
  { provider: "alibaba", model: "qwen3.8-flash", label: "Qwen3.8 Flash: fast and low cost", enabled: true, minPlan: "free" },
  { provider: "alibaba", model: "qwen3.7-plus", label: "Qwen3.7 Plus: balanced", enabled: true, minPlan: "starter" },
  { provider: "alibaba", model: "qwen4-max", label: "Qwen4 Max: best reasoning and writing", enabled: true, minPlan: "pro" },
  { provider: "anthropic", model: "claude-haiku-5-5", label: "Claude Haiku 5.5: fast and low cost", enabled: true, minPlan: "free" },
  { provider: "anthropic", model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5: balanced", enabled: true, minPlan: "starter" },
  { provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5: most capable", enabled: true, minPlan: "pro" },
];

export const modelKey = (m: { provider: string; model: string }) => `${m.provider}:${m.model}`;

export function parseModelKey(key: string | null | undefined): { provider: KeyedProvider; model: string } | null {
  if (!key) return null;
  const i = key.indexOf(":");
  if (i < 1) return null;
  const provider = key.slice(0, i);
  const model = key.slice(i + 1);
  return isKeyedProvider(provider) && model ? { provider, model } : null;
}

function isPlan(v: unknown): v is ModelPlan {
  return typeof v === "string" && (MODEL_PLANS as readonly string[]).includes(v);
}

/** Read whatever is stored (including nothing) into a full state. */
export function normalizePlatformAi(raw: unknown): PlatformAiState {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as StoredPlatformAi & Record<string, unknown>) : {};
  const providers: Partial<Record<KeyedProvider, StoredProvider>> = {};
  if (c.providers && typeof c.providers === "object") {
    for (const p of KEYED_PROVIDERS) {
      const v = (c.providers as Record<string, unknown>)[p];
      if (v && typeof v === "object") providers[p] = v as StoredProvider;
    }
  } else if (c.provider === "alibaba") {
    // The first, Alibaba-only shape: { enabled, provider, region, workspaceId, baseUrl, models, apiKey }.
    providers.alibaba = { apiKey: c.apiKey, region: c.region as string, workspaceId: c.workspaceId as string | null, baseUrl: c.baseUrl as string | null };
  }

  let models: PlatformModel[] = BUILTIN_MODELS.map((m) => ({ ...m }));
  if (Array.isArray(c.models)) {
    const seen = new Set<string>();
    models = [];
    for (const m of c.models as unknown[]) {
      if (!m || typeof m !== "object") continue;
      const e = m as Record<string, unknown>;
      if (!isKeyedProvider(e.provider) || typeof e.model !== "string" || !e.model.trim()) continue;
      const entry: PlatformModel = {
        provider: e.provider,
        model: e.model.trim(),
        label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : e.model.trim(),
        enabled: e.enabled !== false,
        minPlan: isPlan(e.minPlan) ? e.minPlan : "free",
      };
      if (seen.has(modelKey(entry))) continue;
      seen.add(modelKey(entry));
      models.push(entry);
    }
  }

  const defaults: Partial<Record<AiTask, string>> = {};
  if (c.defaults && typeof c.defaults === "object" && !Array.isArray(c.defaults)) {
    for (const t of AI_TASKS) {
      const v = (c.defaults as Record<string, unknown>)[t];
      if (typeof v === "string" && parseModelKey(v)) defaults[t] = v;
    }
  }
  return { providers, models, defaults };
}

type Env = Record<string, string | undefined>;

const ENV_KEYS: Record<KeyedProvider, { key: string; baseUrl: string }> = {
  anthropic: { key: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" },
  openai: { key: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
  alibaba: { key: "ALIBABA_API_KEY", baseUrl: "ALIBABA_BASE_URL" },
};

/** Where a provider's key comes from. */
export function keySource(state: PlatformAiState, provider: KeyedProvider, env: Env, decrypt: (p: unknown) => string | null): "stored" | "env" | null {
  if (decrypt(state.providers[provider]?.apiKey)) return "stored";
  return env[ENV_KEYS[provider].key] ? "env" : null;
}

/** Credentials for a provider: the stored key first, then env. */
export function providerCredentials(
  state: PlatformAiState,
  provider: KeyedProvider,
  env: Env,
  decrypt: (p: unknown) => string | null
): ProviderCredentials | null {
  const s = state.providers[provider];
  const stored = decrypt(s?.apiKey);
  if (stored) {
    let baseUrl = s?.baseUrl?.trim() || undefined;
    if (provider === "alibaba" && !baseUrl) {
      const region = isAlibabaRegion(s?.region) ? s.region : "singapore";
      const url = alibabaBaseUrl(region, s?.workspaceId);
      if (!url) return null;
      baseUrl = url;
    }
    return { apiKey: stored, baseUrl };
  }
  const apiKey = env[ENV_KEYS[provider].key];
  return apiKey ? { apiKey, baseUrl: env[ENV_KEYS[provider].baseUrl] || undefined } : null;
}

export interface TenantAiChoice {
  plan: string;
  /** Business.aiModel: "provider:model" or null. */
  aiModel: string | null;
}

/** Can this plan pick this model? */
export function planAllows(plan: string, m: PlatformModel): boolean {
  return planRank(plan) >= planRank(m.minPlan);
}

/** Models a tenant on `plan` may pick right now (enabled, keyed, allowed). */
export function availableModels(state: PlatformAiState, plan: string, hasKey: (p: KeyedProvider) => boolean) {
  return state.models.filter((m) => m.enabled && hasKey(m.provider) && planAllows(plan, m));
}

const BUILTIN_TASK_MODELS: Partial<Record<KeyedProvider, Record<AiTask, string>>> = {
  anthropic: ANTHROPIC_TASK_MODELS,
  alibaba: ALIBABA_TASK_MODELS,
};

/**
 * Pick provider and model for a call, or null to fall through to the env
 * default. Order:
 *  1. the tenant's chosen model (not for "classify"), if still enabled, keyed
 *     and allowed on its plan;
 *  2. the platform default for the task;
 *  3. (only when `allowAuto`) the first provider with a stored key, using its
 *     built-in model for the task.
 */
export function resolveFromPlatform(
  task: AiTask,
  state: PlatformAiState,
  tenant: TenantAiChoice | null,
  creds: (p: KeyedProvider) => ProviderCredentials | null,
  opts: { allowAuto: boolean; storedKeys?: KeyedProvider[] }
): ResolvedProvider | null {
  const make = (provider: ProviderId, model: string, c: ProviderCredentials, source: ResolvedProvider["source"]): ResolvedProvider => ({ provider, model, credentials: c, source });

  if (tenant?.aiModel && task !== "classify") {
    const ref = parseModelKey(tenant.aiModel);
    const entry = ref && state.models.find((m) => m.provider === ref.provider && m.model === ref.model);
    if (entry && entry.enabled && planAllows(tenant.plan, entry)) {
      const c = creds(entry.provider);
      if (c) return make(entry.provider, entry.model, c, "tenant");
    }
  }

  const def = parseModelKey(state.defaults[task]);
  if (def) {
    const c = creds(def.provider);
    if (c) return make(def.provider, def.model, c, "platform");
  }

  if (opts.allowAuto) {
    for (const p of opts.storedKeys ?? []) {
      const builtin = BUILTIN_TASK_MODELS[p]?.[task] ?? state.models.find((m) => m.provider === p && m.enabled)?.model;
      const c = builtin ? creds(p) : null;
      if (builtin && c) return make(p, builtin, c, "platform");
    }
  }
  return null;
}
