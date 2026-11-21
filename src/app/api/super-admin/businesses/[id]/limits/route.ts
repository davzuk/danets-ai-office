import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { LIMIT_FIELDS, pickLimits, type LimitKey } from "@/lib/limit-fields";

type RouteCtx = { params: Promise<{ id: string }> };

// null = use the plan's value; a number replaces it for this tenant (0 = unlimited).
const limitShape = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, z.number().int().min(0).nullable().optional()])) as Record<
  LimitKey,
  z.ZodOptional<z.ZodNullable<z.ZodNumber>>
>;

const patchSchema = z.object({
  ...limitShape,
  notes: z.string().max(500).nullable().optional(),
  clear: z.boolean().optional(),
});

function overrideView(o: { notes: string | null; updatedAt: Date } & Partial<Record<LimitKey, number | null>>) {
  return { ...pickLimits(o, false), notes: o.notes, updatedAt: o.updatedAt.toISOString() };
}

// GET /api/super-admin/businesses/[id]/limits
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { id } = await params;
  const business = await db.business.findUnique({
    where: { id },
    select: { id: true, plan: true, limitOverride: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const planRow = await db.subscriptionPlan.findUnique({
    where: { name: business.plan },
  });

  return NextResponse.json({
    businessId: id,
    plan: business.plan,
    planDefaults: pickLimits(planRow, true),
    override: business.limitOverride ? overrideView(business.limitOverride) : null,
  });
}

// PATCH /api/super-admin/businesses/[id]/limits — per-tenant quota overrides
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const { id } = await params;
  const business = await db.business.findUnique({ where: { id } });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  if (parsed.data.clear) {
    await db.businessLimitOverride.deleteMany({ where: { businessId: id } });
    await logActivity({
      businessId: id,
      userId: user.userId,
      userName: `${user.name} (Platform Admin)`,
      action: "limit_override_cleared",
      module: "subscription",
      description: `Cleared custom quota overrides for ${business.name}`,
    });
    return NextResponse.json({ ok: true, override: null });
  }

  const data: Partial<Record<LimitKey, number | null>> & { notes?: string | null } = {};
  for (const f of LIMIT_FIELDS) {
    if (parsed.data[f.key] !== undefined) data[f.key] = parsed.data[f.key];
  }
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const override = await db.businessLimitOverride.upsert({
    where: { businessId: id },
    create: { businessId: id, ...data },
    update: data,
  });

  await logActivity({
    businessId: id,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: "limit_override_updated",
    module: "subscription",
    description: `Updated custom quota overrides for ${business.name}`,
    metadata: data,
  });

  return NextResponse.json({ override: overrideView(override) });
}
