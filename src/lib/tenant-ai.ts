import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { decryptApiKey } from "@/lib/crypto";
import { clearAiProviderCache } from "@/lib/llm";
import { resolveProvider } from "@/lib/llm/resolve";
import {
  PROVIDER_LABELS,
  modelKey,
  normalizePlatformAi,
  parseModelKey,
  planAllows,
  providerCredentials,
} from "@/lib/llm/platform-models";
import { formatPlanLabel } from "@/lib/module-registry";

// A tenant picks one AI model from the platform's list. The platform holds
// every key; this only stores "provider:model" on Business.aiModel.

async function loadState() {
  const row = await db.platformConfig.findUnique({ where: { id: "default" }, select: { aiConfig: true } });
  return normalizePlatformAi(row?.aiConfig);
}

/** The picker: every enabled model with a key, marked allowed or not for this plan. */
export async function getTenantAiView(businessId: string) {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { plan: true, aiModel: true } });
  if (!business) throw new AppError("Business not found", { status: 404, code: "NOT_FOUND" });
  const plan = business.plan || "free";
  const state = await loadState();
  const hasKey = (p: Parameters<typeof providerCredentials>[1]) => !!providerCredentials(state, p, process.env, decryptApiKey);

  const options = state.models
    .filter((m) => m.enabled && hasKey(m.provider))
    .map((m) => ({
      key: modelKey(m),
      label: m.label,
      model: m.model,
      provider: m.provider,
      providerLabel: PROVIDER_LABELS[m.provider],
      minPlan: m.minPlan,
      minPlanLabel: formatPlanLabel(m.minPlan),
      allowed: planAllows(plan, m),
    }));

  const chosen = business.aiModel ? options.find((o) => o.key === business.aiModel) ?? null : null;
  // What actually answers chat right now (the choice may be off or above the plan).
  const effective = await resolveProvider(businessId, "chat");
  const effectiveOption = options.find((o) => o.key === modelKey({ provider: effective.provider, model: effective.model }));
  return {
    plan,
    planLabel: formatPlanLabel(plan),
    selected: business.aiModel,
    /** The saved choice can't be used (turned off, no key, or above the plan). */
    selectedUnavailable: !!business.aiModel && !(chosen && chosen.allowed),
    options,
    effective: {
      provider: effective.provider,
      model: effective.model,
      label: effectiveOption?.label ?? (effective.provider === "zai" ? "Built-in model" : effective.model),
    },
  };
}
export type TenantAiView = Awaited<ReturnType<typeof getTenantAiView>>;

export const tenantModelSchema = z.object({
  /** "provider:model", or null for the platform default. */
  model: z.string().max(120).nullable(),
});

/** Save a tenant's model: enabled, keyed, and allowed on its plan. */
export async function setTenantAiModel(businessId: string, key: string | null) {
  if (key) {
    const ref = parseModelKey(key);
    const business = await db.business.findUnique({ where: { id: businessId }, select: { plan: true } });
    if (!business) throw new AppError("Business not found", { status: 404, code: "NOT_FOUND" });
    const state = await loadState();
    const entry = ref && state.models.find((m) => m.provider === ref.provider && m.model === ref.model);
    if (!entry || !entry.enabled || !providerCredentials(state, entry.provider, process.env, decryptApiKey)) {
      throw new AppError("That model isn't available.", { status: 400, code: "UNAVAILABLE" });
    }
    if (!planAllows(business.plan || "free", entry)) {
      throw new AppError(`${entry.label} needs the ${formatPlanLabel(entry.minPlan)} plan or higher.`, { status: 403, code: "PLAN_REQUIRED" });
    }
  }
  await db.business.update({ where: { id: businessId }, data: { aiModel: key } });
  clearAiProviderCache(businessId);
  return getTenantAiView(businessId);
}
