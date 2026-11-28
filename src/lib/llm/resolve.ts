// Decide which provider, model and credentials serve a call.
//
// The platform owns every AI key (see platform-models.ts). Order:
//  1. the tenant's chosen model, if its plan allows it (never for "classify");
//  2. the platform default model for the task (Platform settings → AI);
//  3. the env default (AI_DEFAULT_PROVIDER, ANTHROPIC_API_KEY, ...);
//  4. any provider with a key saved in Platform settings;
//  5. the built-in z-ai model.
// Tenants' own `ai_provider` integrations are no longer used.

import { ANTHROPIC_TASK_MODELS } from "./catalog";
import {
  KEYED_PROVIDERS,
  normalizePlatformAi,
  providerCredentials,
  resolveFromPlatform,
  type KeyedProvider,
  type PlatformAiState,
  type TenantAiChoice,
} from "./platform-models";
import { ALIBABA_TASK_MODELS } from "./providers/alibaba";
import type { AiTask, ProviderId, ResolvedProvider } from "./types";

type Env = Record<string, string | undefined>;

const ZAI_MODEL = "zai-default";

function isProviderId(v: unknown): v is ProviderId {
  return v === "anthropic" || v === "openai" || v === "alibaba" || v === "zai";
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
  if (provider === "alibaba" && env.ALIBABA_API_KEY) {
    return {
      provider,
      model: pickModel(task, overrides, ALIBABA_TASK_MODELS[task])!,
      credentials: { apiKey: env.ALIBABA_API_KEY, baseUrl: env.ALIBABA_BASE_URL || undefined },
      source: "platform",
    };
  }
  return { provider: "zai", model: ZAI_MODEL, credentials: {}, source: "platform" };
}

// ─── DB-backed resolver with a short cache ─────────────────────────────

const CACHE_TTL_MS = 60_000;

interface PlatformSnapshot {
  state: PlatformAiState;
  /** Providers with a key saved in Platform settings, in auto-pick order. */
  storedKeys: KeyedProvider[];
  decrypt: (p: unknown) => string | null;
}

let platformCache: { at: number; snap: PlatformSnapshot } | null = null;
const tenantCache = new Map<string, { at: number; choice: TenantAiChoice | null }>();

/**
 * Call after a tenant's model choice or plan changes (with its id), or with
 * no argument after the platform AI settings change.
 */
export function clearAiProviderCache(businessId?: string) {
  if (businessId) tenantCache.delete(businessId);
  else {
    tenantCache.clear();
    platformCache = null;
  }
}

const AUTO_ORDER: KeyedProvider[] = ["anthropic", "alibaba", "openai"];

async function loadPlatform(): Promise<PlatformSnapshot> {
  if (platformCache && Date.now() - platformCache.at < CACHE_TTL_MS) return platformCache.snap;
  const { decryptApiKey } = await import("@/lib/crypto");
  let raw: unknown = null;
  try {
    const { db } = await import("@/lib/db");
    raw = (await db.platformConfig.findUnique({ where: { id: "default" }, select: { aiConfig: true } }))?.aiConfig;
  } catch {
    raw = null; // e.g. the column isn't migrated yet: env only
  }
  const state = normalizePlatformAi(raw);
  const storedKeys = AUTO_ORDER.filter((p) => KEYED_PROVIDERS.includes(p) && !!decryptApiKey(state.providers[p]?.apiKey));
  const snap = { state, storedKeys, decrypt: decryptApiKey };
  platformCache = { at: Date.now(), snap };
  return snap;
}

async function loadTenant(businessId: string): Promise<TenantAiChoice | null> {
  const hit = tenantCache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.choice;
  let choice: TenantAiChoice | null = null;
  try {
    const { db } = await import("@/lib/db");
    const b = await db.business.findUnique({ where: { id: businessId }, select: { plan: true, aiModel: true } });
    choice = b ? { plan: b.plan || "free", aiModel: b.aiModel } : null;
  } catch {
    choice = null;
  }
  tenantCache.set(businessId, { at: Date.now(), choice });
  return choice;
}

export async function resolveProvider(businessId: string | undefined, task: AiTask): Promise<ResolvedProvider> {
  const snap = await loadPlatform();
  const tenant = businessId ? await loadTenant(businessId) : null;
  const creds = (p: KeyedProvider) => providerCredentials(snap.state, p, process.env, snap.decrypt);

  const chosen = resolveFromPlatform(task, snap.state, tenant, creds, { allowAuto: false });
  if (chosen) return chosen;
  const env = resolvePlatformDefault(task, process.env);
  if (env.provider !== "zai") return env;
  return resolveFromPlatform(task, snap.state, null, creds, { allowAuto: true, storedKeys: snap.storedKeys }) ?? env;
}
