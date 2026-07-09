import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/subscription-access";
import { getTenantModuleAccess } from "@/lib/module-access";

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

  return NextResponse.json({
    user: s,
    subscription,
    modules: moduleAccess,
  });
}
