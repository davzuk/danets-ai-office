import { db } from "@/lib/db";

export async function isFeatureEnabled(businessId: string, key: string): Promise<boolean> {
  const override = await db.businessFeatureFlag.findUnique({
    where: { businessId_flagKey: { businessId, flagKey: key } },
    select: { enabled: true },
  });
  if (override) return override.enabled;

  const flag = await db.platformFeatureFlag.findUnique({
    where: { key },
    select: { enabled: true },
  });
  return flag?.enabled ?? false;
}

export async function getFeatureFlagsForBusiness(businessId: string) {
  const flags = await db.platformFeatureFlag.findMany({
    orderBy: { name: "asc" },
  });
  const overrides = await db.businessFeatureFlag.findMany({
    where: { businessId },
    select: { flagKey: true, enabled: true },
  });
  const overrideMap = new Map(overrides.map((o) => [o.flagKey, o.enabled]));

  return flags.map((f) => {
    const hasOverride = overrideMap.has(f.key);
    const effective = hasOverride ? overrideMap.get(f.key)! : f.enabled;
    return {
      key: f.key,
      name: f.name,
      description: f.description,
      globalEnabled: f.enabled,
      hasOverride,
      enabled: effective,
    };
  });
}
