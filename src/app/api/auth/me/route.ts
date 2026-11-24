import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/subscription-access";
import { getTenantModuleAccess } from "@/lib/module-access";
import { readBrand } from "@/lib/white-label/brand";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ user: null, subscription: null, modules: null });

  const subscription =
    s.isSuperAdmin || s.isImpersonating
      ? null
      : await getSubscriptionAccess(s.businessId);

  const moduleAccess =
    s.isSuperAdmin || s.isImpersonating
      ? null
      : await getTenantModuleAccess(s.businessId);

  // Surface the tenant-level 2FA policy so the settings view can render
  // the "require 2FA for all members" toggle and lock the disable button.
  let enforce2fa = false;
  if (!s.isSuperAdmin) {
    const business = await db.business.findUnique({
      where: { id: s.businessId },
      select: { enforce2fa: true },
    });
    enforce2fa = !!business?.enforce2fa;
  }

  return NextResponse.json({
    user: { ...s, enforce2fa },
    subscription,
    modules: moduleAccess,
    brand: await readBrand(),
  });
}
