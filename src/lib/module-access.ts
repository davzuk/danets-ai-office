import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  MODULE_KEYS,
  MODULE_REGISTRY,
  type ModuleKey,
  planRank,
  resolveModuleFromApiPath,
  isModuleExemptApiPath,
  formatPlanLabel,
} from "@/lib/module-registry";

export type ModuleAccessInfo = {
  enabled: boolean;
  label: string;
  requiredPlan: string;
  requiredPlanLabel: string;
};

export type TenantModuleAccess = {
  plan: string;
  modules: Record<ModuleKey, ModuleAccessInfo>;
  enabledModules: ModuleKey[];
};

export class ModuleAccessError extends Error {
  readonly module: ModuleKey;
  readonly requiredPlan: string;

  constructor(module: ModuleKey, requiredPlan: string) {
    super(`MODULE_REQUIRED:${module}:${requiredPlan}`);
    this.module = module;
    this.requiredPlan = requiredPlan;
  }
}

export async function getBusinessPlan(businessId: string): Promise<string> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { plan: true },
  });
  return business?.plan || "free";
}

export async function isModuleEnabled(
  businessId: string,
  moduleKey: ModuleKey,
  plan?: string
): Promise<boolean> {
  const def = MODULE_REGISTRY[moduleKey];
  if (!def) return false;
  if (def.alwaysEnabled) return true;

  const effectivePlan = plan ?? (await getBusinessPlan(businessId));
  if (planRank(effectivePlan) < planRank(def.minPlan)) return false;

  if (def.flagKey) {
    const enabled = await isFeatureEnabled(businessId, def.flagKey);
    if (!enabled) return false;
  }

  return true;
}

export async function getTenantModuleAccess(
  businessId: string
): Promise<TenantModuleAccess> {
  const plan = await getBusinessPlan(businessId);
  const modules = {} as Record<ModuleKey, ModuleAccessInfo>;
  const enabledModules: ModuleKey[] = [];

  for (const key of MODULE_KEYS) {
    const def = MODULE_REGISTRY[key];
    const enabled = await isModuleEnabled(businessId, key, plan);
    modules[key] = {
      enabled,
      label: def.label,
      requiredPlan: def.minPlan,
      requiredPlanLabel: formatPlanLabel(def.minPlan),
    };
    if (enabled) enabledModules.push(key);
  }

  return { plan, modules, enabledModules };
}

export async function enforceModuleAccess(
  businessId: string,
  pathname: string
): Promise<void> {
  if (!pathname.startsWith("/api/") || isModuleExemptApiPath(pathname)) return;

  const moduleKey = resolveModuleFromApiPath(pathname);
  if (!moduleKey) return;

  const def = MODULE_REGISTRY[moduleKey];
  const enabled = await isModuleEnabled(businessId, moduleKey);
  if (!enabled) {
    throw new ModuleAccessError(moduleKey, def.minPlan);
  }
}
