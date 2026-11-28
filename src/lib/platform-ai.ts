import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { decryptApiKey, encryptApiKey, maskApiKey } from "@/lib/crypto";
import { AI_TASKS, clearAiProviderCache, type AiTask } from "@/lib/llm";
import { ANTHROPIC_TASK_MODELS } from "@/lib/llm/catalog";
import {
  BUILTIN_MODELS,
  KEYED_PROVIDERS,
  MODEL_PLANS,
  PROVIDER_LABELS,
  keySource,
  modelKey,
  normalizePlatformAi,
  parseModelKey,
  providerCredentials,
  type KeyedProvider,
  type PlatformAiState,
  type StoredPlatformAi,
  type StoredProvider,
} from "@/lib/llm/platform-models";
import { anthropicProvider } from "@/lib/llm/providers/anthropic";
import { openAiProvider } from "@/lib/llm/providers/openai";
import {
  ALIBABA_REGION_IDS,
  ALIBABA_REGIONS,
  ALIBABA_TASK_MODELS,
  WORKSPACE_ID_RE,
  alibabaBaseUrl,
  alibabaProvider,
  isAlibabaRegion,
  type AlibabaRegion,
} from "@/lib/llm/providers/alibaba";
import type { ProviderAdapter } from "@/lib/llm/types";

// The platform's AI keys and model list, set in Platform settings → AI.
// Tenants only pick a model from this list (see tenant-ai.ts).

// Same row as platform-config.ts (not imported, to avoid a cycle with its setup checks).
const PLATFORM_CONFIG_ID = "default";

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

/** Each provider's key may only go to that provider's own domains. */
const ALLOWED_HOSTS: Record<KeyedProvider, string[]> = {
  alibaba: ["aliyuncs.com"],
  anthropic: ["anthropic.com"],
  openai: ["openai.com"],
};

function isAllowedUrl(provider: KeyedProvider, u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && ALLOWED_HOSTS[provider].some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const ADAPTERS: Record<KeyedProvider, ProviderAdapter> = {
  anthropic: anthropicProvider,
  openai: openAiProvider,
  alibaba: alibabaProvider,
};

// ─── Storage ─────────────────────────────────────────────────────────

async function readRaw(): Promise<StoredPlatformAi | null> {
  const row = await db.platformConfig.findUnique({ where: { id: PLATFORM_CONFIG_ID }, select: { aiConfig: true } });
  const c = row?.aiConfig;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as StoredPlatformAi) : null;
}

async function readState(): Promise<{ raw: StoredPlatformAi | null; state: PlatformAiState }> {
  const raw = await readRaw();
  return { raw, state: normalizePlatformAi(raw) };
}

async function writeState(state: PlatformAiState, by: string) {
  const stored: StoredPlatformAi = {
    version: 2,
    providers: state.providers,
    models: state.models,
    defaults: state.defaults,
    updatedBy: by,
    updatedAt: new Date().toISOString(),
  };
  await db.platformConfig.upsert({
    where: { id: PLATFORM_CONFIG_ID },
    create: { id: PLATFORM_CONFIG_ID, aiConfig: stored as Prisma.InputJsonValue },
    update: { aiConfig: stored as Prisma.InputJsonValue },
  });
  clearAiProviderCache();
}

// ─── View ────────────────────────────────────────────────────────────

function alibabaEndpoint(s: StoredProvider | undefined) {
  const region: AlibabaRegion = isAlibabaRegion(s?.region) ? s.region : "singapore";
  return s?.baseUrl?.trim() || alibabaBaseUrl(region, s?.workspaceId);
}

/** What the settings page shows. Never includes a key. */
export async function getPlatformAiView() {
  const { raw, state } = await readState();
  const env = process.env;
  const sources = Object.fromEntries(KEYED_PROVIDERS.map((p) => [p, keySource(state, p, env, decryptApiKey)])) as Record<KeyedProvider, "stored" | "env" | null>;
  const usable = (p: KeyedProvider) => !!providerCredentials(state, p, env, decryptApiKey);

  const providers = KEYED_PROVIDERS.map((p) => {
    const s = state.providers[p];
    const key = decryptApiKey(s?.apiKey);
    return {
      provider: p,
      label: PROVIDER_LABELS[p],
      keySource: sources[p],
      keyMasked: key ? maskApiKey(key) : "",
      /** A key is saved but can't be decrypted (the encryption key changed). */
      keyUnreadable: !!s?.apiKey && !key,
      usable: usable(p),
      baseUrl: s?.baseUrl ?? "",
      region: p === "alibaba" ? (isAlibabaRegion(s?.region) ? s.region : "singapore") : null,
      workspaceId: p === "alibaba" ? (s?.workspaceId ?? "") : null,
      endpoint: p === "alibaba" ? alibabaEndpoint(s) : null,
    };
  });

  const counts = await db.business.groupBy({ by: ["aiModel"], where: { aiModel: { not: null } }, _count: { _all: true } });
  const tenantsOn = new Map(counts.map((c) => [c.aiModel as string, c._count._all]));

  return {
    providers,
    models: state.models.map((m) => ({ ...m, key: modelKey(m), hasKey: usable(m.provider), tenants: tenantsOn.get(modelKey(m)) ?? 0 })),
    defaults: state.defaults,
    customised: Array.isArray(raw?.models),
    updatedBy: raw?.updatedBy ?? null,
    updatedAt: raw?.updatedAt ?? null,
    options: {
      plans: MODEL_PLANS,
      tasks: AI_TASKS,
      regions: ALIBABA_REGION_IDS.map((id) => ({ id, label: ALIBABA_REGIONS[id].label, needsWorkspace: !ALIBABA_REGIONS[id].legacyHost })),
      builtinTaskModels: { anthropic: ANTHROPIC_TASK_MODELS, alibaba: ALIBABA_TASK_MODELS },
    },
  };
}
export type PlatformAiView = Awaited<ReturnType<typeof getPlatformAiView>>;

// ─── Provider keys ───────────────────────────────────────────────────

export const providerSchema = z
  .object({
    provider: z.enum(KEYED_PROVIDERS),
    /** A new key. Omit to keep the saved one. */
    apiKey: z.string().trim().min(8, "That API key looks too short.").max(400).optional(),
    baseUrl: z.string().trim().max(300).optional(),
    region: z.enum(ALIBABA_REGION_IDS as [AlibabaRegion, ...AlibabaRegion[]]).optional(),
    workspaceId: z
      .string()
      .trim()
      .max(63)
      .refine((v) => !v || WORKSPACE_ID_RE.test(v), "The workspace ID can only use letters, digits and dashes.")
      .optional(),
    /** Test only: which model to try. */
    model: z.string().trim().max(80).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.baseUrl && !isAllowedUrl(v.provider, v.baseUrl)) {
      ctx.addIssue({ code: "custom", path: ["baseUrl"], message: `The base URL must be an https address on ${ALLOWED_HOSTS[v.provider].join(" or ")}.` });
    }
    if (v.model && !MODEL_RE.test(v.model)) ctx.addIssue({ code: "custom", path: ["model"], message: "Model names can only use letters, digits and . _ : / -" });
  });
export type ProviderInput = z.infer<typeof providerSchema>;

function mergedProvider(prev: StoredProvider | undefined, input: ProviderInput): StoredProvider {
  const next: StoredProvider = {
    apiKey: input.apiKey ? encryptApiKey(input.apiKey) : prev?.apiKey ?? null,
    baseUrl: input.baseUrl || null,
  };
  if (input.provider === "alibaba") {
    next.region = input.region ?? (isAlibabaRegion(prev?.region) ? prev.region : "singapore");
    next.workspaceId = input.workspaceId || null;
  }
  return next;
}

function checkAlibabaEndpoint(s: StoredProvider) {
  if (!alibabaEndpoint(s)) {
    const region = isAlibabaRegion(s.region) ? s.region : "singapore";
    throw new AppError(`${ALIBABA_REGIONS[region].label} needs a workspace ID.`, { status: 400, code: "NO_WORKSPACE" });
  }
}

export async function saveProvider(input: ProviderInput, by: string) {
  const { state } = await readState();
  const next = mergedProvider(state.providers[input.provider], input);
  if (!decryptApiKey(next.apiKey)) throw new AppError(`Add an API key for ${PROVIDER_LABELS[input.provider]}.`, { status: 400, code: "NO_KEY" });
  if (input.provider === "alibaba") checkAlibabaEndpoint(next);
  state.providers[input.provider] = next;
  await writeState(state, by);
  return getPlatformAiView();
}

export async function removeProviderKey(provider: KeyedProvider, by: string) {
  const { state } = await readState();
  delete state.providers[provider];
  await writeState(state, by);
  return getPlatformAiView();
}

/** The fast model each provider is tested with. */
function testModel(provider: KeyedProvider, state: PlatformAiState, requested?: string) {
  if (requested) return requested;
  if (provider === "anthropic") return "claude-haiku-5-5";
  if (provider === "alibaba") return ALIBABA_TASK_MODELS.classify;
  return state.models.find((m) => m.provider === "openai" && m.enabled)?.model ?? null;
}

/**
 * Send one tiny request with the form's values (or the saved key when no new
 * key is given), so an admin can check a key before relying on it.
 */
export async function testProvider(input: ProviderInput) {
  const { state } = await readState();
  const merged = mergedProvider(state.providers[input.provider], input);
  const probe = { ...state, providers: { ...state.providers, [input.provider]: merged } };
  if (input.provider === "alibaba") checkAlibabaEndpoint(merged);
  const creds = providerCredentials(probe, input.provider, process.env, decryptApiKey);
  if (!creds?.apiKey) throw new AppError("Enter an API key to test.", { status: 400, code: "NO_KEY" });
  const model = testModel(input.provider, state, input.model);
  if (!model) throw new AppError("Add an OpenAI model to the list first, or name one to test with.", { status: 400, code: "NO_MODEL" });

  const started = Date.now();
  const where = creds.baseUrl ?? null;
  try {
    const res = await ADAPTERS[input.provider].chat(
      { model, task: "classify", messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 20 },
      creds
    );
    return { ok: true as const, model: res.model, reply: res.content.trim().slice(0, 80), latencyMs: Date.now() - started, endpoint: where };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Never echo the key back, even if the API quoted it.
    return { ok: false as const, model, error: msg.split(creds.apiKey).join("••••").slice(0, 400), endpoint: where };
  }
}

// ─── Models and defaults ─────────────────────────────────────────────

const modelEntrySchema = z.object({
  provider: z.enum(KEYED_PROVIDERS),
  model: z.string().trim().regex(MODEL_RE, "Model names can only use letters, digits and . _ : / -"),
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  minPlan: z.enum(MODEL_PLANS),
});

export const modelsSchema = z.object({
  models: z.array(modelEntrySchema).max(60),
  defaults: z.object(Object.fromEntries(AI_TASKS.map((t) => [t, z.string().max(120).optional()])) as Record<AiTask, z.ZodOptional<z.ZodString>>).partial(),
});
export type ModelsInput = z.infer<typeof modelsSchema>;

export async function saveModels(input: ModelsInput, by: string) {
  const seen = new Set<string>();
  for (const m of input.models) {
    const k = modelKey(m);
    if (seen.has(k)) throw new AppError(`${m.model} is listed twice.`, { status: 400, code: "DUPLICATE" });
    seen.add(k);
  }
  const defaults: Partial<Record<AiTask, string>> = {};
  for (const t of AI_TASKS) {
    const v = input.defaults[t];
    if (!v) continue;
    if (!parseModelKey(v) || !seen.has(v)) throw new AppError(`The default for ${t} must be a model in the list.`, { status: 400, code: "BAD_DEFAULT" });
    defaults[t] = v;
  }
  const { state } = await readState();
  state.models = input.models;
  state.defaults = defaults;
  await writeState(state, by);
  return getPlatformAiView();
}

/** Put the built-in model list back (keys and defaults stay). */
export async function resetModels(by: string) {
  const { state } = await readState();
  state.models = BUILTIN_MODELS.map((m) => ({ ...m }));
  const keys = new Set(state.models.map(modelKey));
  for (const t of AI_TASKS) if (state.defaults[t] && !keys.has(state.defaults[t]!)) delete state.defaults[t];
  await writeState(state, by);
  return getPlatformAiView();
}

/** For the setup checklist: which providers have keys saved here. */
export async function platformAiStatus(): Promise<{ stored: string[]; unreadable: string[] } | null> {
  try {
    const { state } = await readState();
    const stored: string[] = [];
    const unreadable: string[] = [];
    for (const p of KEYED_PROVIDERS) {
      const s = state.providers[p];
      if (!s?.apiKey) continue;
      (decryptApiKey(s.apiKey) ? stored : unreadable).push(PROVIDER_LABELS[p]);
    }
    return { stored, unreadable };
  } catch {
    return null;
  }
}
