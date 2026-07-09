import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  chatLimit: z.number().int().min(0).nullable().optional(),
  leadLimit: z.number().int().min(0).nullable().optional(),
  kbLimit: z.number().int().min(0).nullable().optional(),
  agentLimit: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  clear: z.boolean().optional(),
});

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
    planDefaults: {
      chatLimit: planRow?.chatLimit ?? 100,
      leadLimit: planRow?.leadLimit ?? 50,
      kbLimit: planRow?.kbLimit ?? 25,
      agentLimit: planRow?.agentLimit ?? 1,
    },
    override: business.limitOverride
      ? {
          chatLimit: business.limitOverride.chatLimit,
          leadLimit: business.limitOverride.leadLimit,
          kbLimit: business.limitOverride.kbLimit,
          agentLimit: business.limitOverride.agentLimit,
          notes: business.limitOverride.notes,
          updatedAt: business.limitOverride.updatedAt.toISOString(),
        }
      : null,
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

  const data: {
    chatLimit?: number | null;
    leadLimit?: number | null;
    kbLimit?: number | null;
    agentLimit?: number | null;
    notes?: string | null;
  } = {};

  if (parsed.data.chatLimit !== undefined) data.chatLimit = parsed.data.chatLimit;
  if (parsed.data.leadLimit !== undefined) data.leadLimit = parsed.data.leadLimit;
  if (parsed.data.kbLimit !== undefined) data.kbLimit = parsed.data.kbLimit;
  if (parsed.data.agentLimit !== undefined) data.agentLimit = parsed.data.agentLimit;
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

  return NextResponse.json({
    override: {
      chatLimit: override.chatLimit,
      leadLimit: override.leadLimit,
      kbLimit: override.kbLimit,
      agentLimit: override.agentLimit,
      notes: override.notes,
      updatedAt: override.updatedAt.toISOString(),
    },
  });
}
