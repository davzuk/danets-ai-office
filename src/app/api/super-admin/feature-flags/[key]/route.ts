import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { listModuleFlags } from "@/lib/module-registry";

// DELETE /api/super-admin/feature-flags/[key]?businessId= — remove tenant override
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { user } = auth;
  const { key } = await params;
  const businessId = new URL(req.url).searchParams.get("businessId");

  if (businessId) {
    const removed = await db.businessFeatureFlag
      .delete({
        where: { businessId_flagKey: { businessId, flagKey: key } },
      })
      .catch(() => null);
    if (removed) {
      await logActivity({
        businessId,
        userId: user.userId,
        userName: `${user.name} (Super Admin)`,
        action: "feature_flag_override_removed",
        module: "business",
        description: `Removed the ${key} override (back to the global setting)`,
        metadata: { flagKey: key },
      });
    }
    return NextResponse.json({ ok: true });
  }

  const deleted = await db.platformFeatureFlag.delete({ where: { key } }).catch(() => null);
  if (deleted) {
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: `${user.name} (Super Admin)`,
      action: "feature_flag_deleted",
      module: "business",
      description: `Deleted feature flag ${key}`,
      metadata: { flagKey: key, modulesLocked: listModuleFlags().filter((m) => m.flagKey === key).map((m) => m.module) },
    });
  }
  return NextResponse.json({ ok: true });
}

// GET /api/super-admin/feature-flags/[key]?businessId= — overrides for a flag
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { key } = await params;
  const businessId = new URL(req.url).searchParams.get("businessId");

  if (businessId) {
    const override = await db.businessFeatureFlag.findUnique({
      where: { businessId_flagKey: { businessId, flagKey: key } },
    });
    const flag = await db.platformFeatureFlag.findUnique({ where: { key } });
    return NextResponse.json({
      flag,
      override,
      effective: override ? override.enabled : flag?.enabled ?? false,
    });
  }

  const overrides = await db.businessFeatureFlag.findMany({
    where: { flagKey: key },
    include: { business: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    overrides: overrides.map((o) => ({
      id: o.id,
      businessId: o.businessId,
      businessName: o.business.name,
      enabled: o.enabled,
      updatedAt: o.updatedAt.toISOString(),
    })),
  });
}
