import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exitImpersonation, getSession } from "@/lib/auth";
import {
  exitPlatformImpersonation,
  getPlatformSession,
  PLATFORM_IMPERSONATOR_COOKIE,
} from "@/lib/platform-auth";
import { logActivity } from "@/lib/activity";

// POST /api/super-admin/impersonate/exit — return to super admin / platform admin session
export async function POST() {
  const cookieStore = await cookies();
  const isPlatformImpersonation = !!cookieStore.get(PLATFORM_IMPERSONATOR_COOKIE)?.value;

  if (isPlatformImpersonation) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not impersonating" }, { status: 400 });
    }

    const impersonatedBusinessId = session.businessId;
    const impersonatedEmail = session.email;

    try {
      await exitPlatformImpersonation();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed";
      if (msg === "EXPIRED") {
        return NextResponse.json({ error: "Platform admin session expired" }, { status: 401 });
      }
      return NextResponse.json({ error: "Failed to exit impersonation" }, { status: 400 });
    }

    const restored = await getPlatformSession();
    if (!restored) {
      return NextResponse.json({ error: "Session restore failed" }, { status: 500 });
    }

    await logActivity({
      businessId: impersonatedBusinessId,
      userId: restored.userId,
      userName: `${restored.name} (Platform Admin)`,
      action: "impersonation_ended",
      module: "auth",
      description: `Platform admin stopped impersonating ${impersonatedEmail}`,
      metadata: { impersonatedEmail, adminEmail: restored.email },
    });

    return NextResponse.json({ user: restored });
  }

  const session = await getSession();
  if (!session?.isImpersonating) {
    return NextResponse.json({ error: "Not impersonating" }, { status: 400 });
  }

  const impersonatedBusinessId = session.businessId;
  const impersonatedEmail = session.email;

  try {
    await exitImpersonation();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "EXPIRED") {
      return NextResponse.json({ error: "Super admin session expired" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to exit impersonation" }, { status: 400 });
  }

  const restored = await getSession();
  if (!restored?.isSuperAdmin) {
    return NextResponse.json({ error: "Session restore failed" }, { status: 500 });
  }

  await logActivity({
    businessId: impersonatedBusinessId,
    userId: restored.userId,
    userName: `${restored.name} (Super Admin)`,
    action: "impersonation_ended",
    module: "auth",
    description: `Super admin stopped impersonating ${impersonatedEmail}`,
    metadata: { impersonatedEmail, adminEmail: restored.email },
  });

  return NextResponse.json({ user: restored });
}
