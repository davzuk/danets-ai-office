import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

// DELETE /api/super-admin/feature-flags/[key]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

  const { key } = await params;
  await db.platformFeatureFlag.delete({ where: { key } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

// GET /api/super-admin/feature-flags/[key]?businessId= — overrides for a flag
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

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
