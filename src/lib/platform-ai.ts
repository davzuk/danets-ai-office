import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { decryptApiKey, encryptApiKey, maskApiKey } from "@/lib/crypto";
import { AI_TASKS, clearAiProviderCache, type AiTask } from "@/lib/llm";
import {
  ALIBABA_MODELS,
  ALIBABA_REGION_IDS,
  ALIBABA_REGIONS,
  ALIBABA_TASK_MODELS,
  WORKSPACE_ID_RE,
  alibabaBaseUrl,
  alibabaProvider,
  isAlibabaRegion,
  type AlibabaRegion,
} from "@/lib/llm/providers/alibaba";
import type { StoredPlatformAi } from "@/lib/llm/resolve";

// Same row as platform-config.ts (not imported, to avoid a cycle with its setup checks).
const PLATFORM_CONFIG_ID = "default";

// The platform's own AI provider, set in Platform settings → AI. It serves
// every tenant without its own AI key, ahead of the env default.

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

/** Only Alibaba's own domains may receive the key. */
function isAlibabaUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && (url.hostname === "aliyuncs.com" || url.hostname.endsWith(".aliyuncs.com"));
  } catch {
    return false;
  }
}

const modelsSchema = z
  .object(Object.fromEntries(AI_TASKS.map((t) => [t, z.string().trim().max(80).optional()])) as Record<AiTask, z.ZodOptional<z.ZodString>>)
  .partial()
  .refine((m) => Object.values(m).every((v) => !v || MODEL_RE.test(v)), "Model names can only use letters, digits and . _ : / -");

export const platformAiSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal("alibaba"),
  region: z.enum(ALIBABA_REGION_IDS as [AlibabaRegion, ...AlibabaRegion[]]),
  workspaceId: z
    .string()
    .trim()
    .max(63)
    .refine((v) => !v || WORKSPACE_ID_RE.test(v), "The workspace ID can only use letters, digits and dashes.")
    .optional(),
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || isAlibabaUrl(v), "The base URL must be an https address on aliyuncs.com.")
    .optional(),
  models: modelsSchema.optional(),
  /** A new key. Omit to keep the saved one. */
  apiKey: z.string().trim().min(8, "That API key looks too short.").max(300).optional(),
});
export type PlatformAiInput = z.infer<typeof platformAiSchema>;

async function readStored(): Promise<(StoredPlatformAi & { updatedBy?: string; updatedAt?: string }) | null> {
  const row = await db.platformConfig.findUnique({ where: { id: PLATFORM_CONFIG_ID }, select: { aiConfig: true } });
  const c = row?.aiConfig;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as StoredPlatformAi) : null;
}

function cleanModels(m: Partial<Record<AiTask, string>> | undefined) {
  const out: Partial<Record<AiTask, string>> = {};
  for (const t of AI_TASKS) {
    const v = m?.[t]?.trim();
    if (v) out[t] = v;
  }
  return out;
}

function endpoint(region: AlibabaRegion, workspaceId?: string | null, baseUrl?: string | null) {
  return baseUrl?.trim() || alibabaBaseUrl(region, workspaceId);
}

/** What the settings page shows. Never includes the key itself. */
export async function getPlatformAiView() {
  const c = await readStored();
  const key = c ? decryptApiKey(c.apiKey) : null;
  const region: AlibabaRegion = isAlibabaRegion(c?.region) ? c.region : "singapore";
  const env = process.env;
  return {
    configured: !!c,
    enabled: !!c?.enabled,
    provider: "alibaba" as const,
    region,
    workspaceId: c?.workspaceId ?? "",
    baseUrl: c?.baseUrl ?? "",
    endpoint: endpoint(region, c?.workspaceId, c?.baseUrl),
    models: cleanModels(c?.models),
    hasKey: !!key,
    keyMasked: maskApiKey(key),
    /** A key is stored but can't be decrypted (the encryption key changed). */
    keyUnreadable: !!c?.apiKey && !key,
    updatedBy: c?.updatedBy ?? null,
    updatedAt: c?.updatedAt ?? null,
    options: {
      regions: ALIBABA_REGION_IDS.map((id) => ({ id, label: ALIBABA_REGIONS[id].label, needsWorkspace: !ALIBABA_REGIONS[id].legacyHost })),
      models: ALIBABA_MODELS,
      taskDefaults: ALIBABA_TASK_MODELS,
      tasks: AI_TASKS,
    },
    /** What serves AI when this is off. */
    envDefault: env.AI_DEFAULT_PROVIDER?.trim() || (env.ANTHROPIC_API_KEY ? "anthropic" : "zai"),
  };
}
export type PlatformAiView = Awaited<ReturnType<typeof getPlatformAiView>>;

export async function savePlatformAi(input: PlatformAiInput, by: string) {
  const prev = await readStored();
  const apiKey = input.apiKey ? encryptApiKey(input.apiKey) : prev?.apiKey;
  const hasKey = input.apiKey ? true : !!decryptApiKey(prev?.apiKey);
  if (input.enabled && !hasKey) throw new AppError("Add an Alibaba Cloud API key before turning this on.", { status: 400, code: "NO_KEY" });
  if (!endpoint(input.region, input.workspaceId, input.baseUrl)) {
    throw new AppError(`${ALIBABA_REGIONS[input.region].label} needs a workspace ID.`, { status: 400, code: "NO_WORKSPACE" });
  }
  const stored = {
    enabled: input.enabled,
    provider: "alibaba",
    region: input.region,
    workspaceId: input.workspaceId || null,
    baseUrl: input.baseUrl || null,
    models: cleanModels(input.models),
    apiKey: apiKey ?? null,
    updatedBy: by,
    updatedAt: new Date().toISOString(),
  };
  await db.platformConfig.upsert({
    where: { id: PLATFORM_CONFIG_ID },
    create: { id: PLATFORM_CONFIG_ID, aiConfig: stored as Prisma.InputJsonValue },
    update: { aiConfig: stored as Prisma.InputJsonValue },
  });
  clearAiProviderCache();
  return getPlatformAiView();
}

export async function removePlatformAi() {
  await db.platformConfig.updateMany({ where: { id: PLATFORM_CONFIG_ID }, data: { aiConfig: Prisma.DbNull } });
  clearAiProviderCache();
  return getPlatformAiView();
}

/**
 * Send one tiny request with the form's values (or the saved key when no new
 * key is given), so an admin can check the key, region and model before
 * switching it on.
 */
export async function testPlatformAi(input: PlatformAiInput) {
  const prev = await readStored();
  const apiKey = input.apiKey || decryptApiKey(prev?.apiKey);
  if (!apiKey) throw new AppError("Enter an API key to test.", { status: 400, code: "NO_KEY" });
  const baseUrl = endpoint(input.region, input.workspaceId, input.baseUrl);
  if (!baseUrl) throw new AppError(`${ALIBABA_REGIONS[input.region].label} needs a workspace ID.`, { status: 400, code: "NO_WORKSPACE" });
  const model = input.models?.classify?.trim() || ALIBABA_TASK_MODELS.classify;
  const started = Date.now();
  try {
    const res = await alibabaProvider.chat(
      { model, task: "classify", messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 20 },
      { apiKey, baseUrl }
    );
    return { ok: true as const, model: res.model, reply: res.content.trim().slice(0, 80), latencyMs: Date.now() - started, endpoint: baseUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Never echo the key back, even if the API quoted it.
    return { ok: false as const, model, error: msg.split(apiKey).join("••••").slice(0, 400), endpoint: baseUrl };
  }
}

/** For the setup checklist. */
export async function platformAiStatus(): Promise<{ active: boolean; label: string } | null> {
  try {
    const c = await readStored();
    if (!c?.enabled) return null;
    const region = isAlibabaRegion(c.region) ? ALIBABA_REGIONS[c.region].label : "unknown region";
    return { active: !!decryptApiKey(c.apiKey), label: `Alibaba Cloud (Qwen), ${region}` };
  } catch {
    return null;
  }
}
