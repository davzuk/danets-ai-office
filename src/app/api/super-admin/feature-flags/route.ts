import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { listModuleFlags } from "@/lib/module-registry";

const createSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "Key must be snake_case"),
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  enabled: z.boolean().default(false),
});

// GET /api/super-admin/feature-flags
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const flags = await db.platformFeatureFlag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { overrides: true } } },
  });

  // Which dashboard modules each flag unlocks, and module flags nobody has created yet
  // (a module whose flag is missing is off for every tenant).
  const moduleFlags = listModuleFlags();
  const existing = new Set(flags.map((f) => f.key));
  const missing = [...new Set(moduleFlags.filter((m) => !existing.has(m.flagKey)).map((m) => m.flagKey))].map((flagKey) => ({
    key: flagKey,
    modules: moduleFlags.filter((m) => m.flagKey === flagKey).map(({ module, label, minPlan }) => ({ module, label, minPlan })),
  }));

  return NextResponse.json({
    missingModuleFlags: missing,
    flags: flags.map((f) => ({
      id: f.id,
      key: f.key,
      name: f.name,
      description: f.description,
      enabled: f.enabled,
      overrideCount: f._count.overrides,
      modules: moduleFlags.filter((m) => m.flagKey === f.key).map(({ module, label, minPlan }) => ({ module, label, minPlan })),
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    })),
  });
}

// POST /api/super-admin/feature-flags
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }

  const existing = await db.platformFeatureFlag.findUnique({
    where: { key: parsed.data.key },
  });
  if (existing) {
    return NextResponse.json({ error: "Flag key already exists" }, { status: 409 });
  }

  const flag = await db.platformFeatureFlag.create({
    data: {
      key: parsed.data.key,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      enabled: parsed.data.enabled,
    },
  });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "feature_flag_created",
    module: "business",
    description: `Created feature flag: ${flag.key}`,
    metadata: { flagKey: flag.key },
  });

  return NextResponse.json({ flag });
}

const overrideSchema = z.object({
  businessId: z.string().min(1),
  flagKey: z.string().min(1),
  enabled: z.boolean(),
});

// PATCH /api/super-admin/feature-flags — toggle global flag or set per-tenant override
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));

  // Per-tenant override
  if (body.businessId && body.flagKey !== undefined) {
    const parsed = overrideSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const flag = await db.platformFeatureFlag.findUnique({
      where: { key: parsed.data.flagKey },
    });
    if (!flag) return NextResponse.json({ error: "Flag not found" }, { status: 404 });

    const business = await db.business.findUnique({
      where: { id: parsed.data.businessId },
      select: { id: true, name: true },
    });
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

    const override = await db.businessFeatureFlag.upsert({
      where: {
        businessId_flagKey: {
          businessId: parsed.data.businessId,
          flagKey: parsed.data.flagKey,
        },
      },
      create: {
        businessId: parsed.data.businessId,
        flagKey: parsed.data.flagKey,
        enabled: parsed.data.enabled,
      },
      update: { enabled: parsed.data.enabled },
    });

    await logActivity({
      businessId: business.id,
      userId: user.userId,
      userName: `${user.name} (Super Admin)`,
      action: "feature_flag_override_set",
      module: "business",
      description: `${parsed.data.enabled ? "Enabled" : "Disabled"} ${flag.key} for ${business.name}`,
      metadata: { flagKey: flag.key, enabled: parsed.data.enabled },
    });

    return NextResponse.json({ override });
  }

  // Global toggle
  const globalSchema = z.object({
    key: z.string().min(1),
    enabled: z.boolean().optional(),
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(300).optional().nullable(),
  });
  const parsed = globalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description?.trim() || null;
  }

  const before = await db.platformFeatureFlag.findUnique({ where: { key: parsed.data.key } });
  if (!before) return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  const flag = await db.platformFeatureFlag.update({
    where: { key: parsed.data.key },
    data,
  });

  if (data.enabled !== undefined && data.enabled !== before.enabled) {
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: `${user.name} (Super Admin)`,
      action: flag.enabled ? "feature_flag_enabled" : "feature_flag_disabled",
      module: "business",
      description: `${flag.enabled ? "Enabled" : "Disabled"} feature flag ${flag.key} globally`,
      metadata: { flagKey: flag.key },
    });
  }

  return NextResponse.json({ flag });
}
