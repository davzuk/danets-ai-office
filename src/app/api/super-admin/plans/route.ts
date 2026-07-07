import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

// GET /api/super-admin/plans — subscription plan catalog
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

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
      chatLimit: p.chatLimit,
      leadLimit: p.leadLimit,
      kbLimit: p.kbLimit,
      features: JSON.parse(p.features || "[]"),
      isActive: p.isActive,
      tenantCount: countMap.get(p.name) || 0,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

const patchSchema = z.object({
  name: z.string().min(1),
  priceUsd: z.number().min(0).optional(),
  chatLimit: z.number().int().min(0).optional(),
  leadLimit: z.number().int().min(0).optional(),
  kbLimit: z.number().int().min(0).optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/super-admin/plans — update plan catalog entry
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

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

  const data: any = {};
  if (parsed.data.priceUsd !== undefined) data.priceUsd = parsed.data.priceUsd;
  if (parsed.data.chatLimit !== undefined) data.chatLimit = parsed.data.chatLimit;
  if (parsed.data.leadLimit !== undefined) data.leadLimit = parsed.data.leadLimit;
  if (parsed.data.kbLimit !== undefined) data.kbLimit = parsed.data.kbLimit;
  if (parsed.data.features !== undefined) data.features = JSON.stringify(parsed.data.features);
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const plan = await db.subscriptionPlan.update({
    where: { name: parsed.data.name },
    data,
  });

  return NextResponse.json({
    plan: {
      ...plan,
      features: JSON.parse(plan.features || "[]"),
    },
  });
}
