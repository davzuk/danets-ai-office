import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { LIMIT_FIELDS, pickLimits, type LimitKey } from "@/lib/limit-fields";

// GET /api/super-admin/plans — subscription plan catalog
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const plans = await db.subscriptionPlan.findMany({
    orderBy: { priceUsd: "asc" },
  });

  const counts = await db.business.groupBy({
    by: ["plan"],
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.plan, c._count._all]));

  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceUsd: p.priceUsd,
      ...pickLimits(p, true),
      auditRetentionDays: p.auditRetentionDays,
      chatRetentionDays: p.chatRetentionDays,
      leadRetentionDays: p.leadRetentionDays,
      features: JSON.parse(p.features || "[]"),
      isActive: p.isActive,
      tenantCount: countMap.get(p.name) || 0,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

const limitShape = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, z.number().int().min(0).optional()])) as Record<
  LimitKey,
  z.ZodOptional<z.ZodNumber>
>;

const patchSchema = z.object({
  name: z.string().min(1),
  priceUsd: z.number().min(0).optional(),
  ...limitShape,
  auditRetentionDays: z.number().int().min(1).optional(),
  chatRetentionDays: z.number().int().min(1).optional(),
  leadRetentionDays: z.number().int().min(1).optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/super-admin/plans — update plan catalog entry
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }

  const existing = await db.subscriptionPlan.findUnique({
    where: { name: parsed.data.name },
  });
  if (!existing) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.priceUsd !== undefined) data.priceUsd = parsed.data.priceUsd;
  for (const f of LIMIT_FIELDS) {
    if (parsed.data[f.key] !== undefined) data[f.key] = parsed.data[f.key];
  }
  if (parsed.data.auditRetentionDays !== undefined) data.auditRetentionDays = parsed.data.auditRetentionDays;
  if (parsed.data.chatRetentionDays !== undefined) data.chatRetentionDays = parsed.data.chatRetentionDays;
  if (parsed.data.leadRetentionDays !== undefined) data.leadRetentionDays = parsed.data.leadRetentionDays;
  if (parsed.data.features !== undefined) data.features = JSON.stringify(parsed.data.features);
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const plan = await db.subscriptionPlan.update({
    where: { name: parsed.data.name },
    data,
  });

  const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify((existing as Record<string, unknown>)[k]));
  if (changed.length) {
    await logActivity({
      businessId: auth.user.businessId,
      userId: auth.user.userId,
      userName: `${auth.user.name} (Super Admin)`,
      action: "plan_updated",
      module: "subscription",
      description: `Updated the ${plan.name} plan (${changed.join(", ")})`,
      metadata: Object.fromEntries(changed.map((k) => [k, { from: (existing as Record<string, unknown>)[k], to: data[k] }])),
    });
  }

  return NextResponse.json({
    plan: {
      ...plan,
      features: JSON.parse(plan.features || "[]"),
    },
  });
}
