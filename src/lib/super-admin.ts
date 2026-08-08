import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getPlatformSession,
  platformAsSessionUser,
  PLATFORM_SESSION_COOKIE,
} from "@/lib/platform-auth";

export type SuperAdminUser = {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
  isSuperAdmin: boolean;
  isPlatformAdmin?: boolean;
  /** Row ID of the Session or PlatformSession behind this auth. Used
   * by the reauth gate to bind the second factor to a specific session. */
  sessionId?: string;
};

export type SuperAdminAuth =
  | { success: true; user: SuperAdminUser; isPlatformAdmin: boolean }
  | { success: false; error: NextResponse };

/** @deprecated Use SuperAdminUser */
export type SuperAdminActor = {
  user: SuperAdminUser;
  isPlatformAdmin: boolean;
};

export async function requireSuperAdmin(): Promise<SuperAdminAuth> {
  const platform = await getPlatformSession();
  if (platform) {
    // Resolve the platform session row ID so reauth can bind the marker
    // to this specific session. The cookie value is the lookup key.
    const cookieStore = await cookies();
    const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
    let sessionId: string | undefined;
    if (token) {
      const row = await db.platformSession.findUnique({
        where: { token },
        select: { id: true },
      });
      sessionId = row?.id;
    }
    const mapped = platformAsSessionUser(platform);
    return {
      success: true,
      user: { ...mapped, sessionId },
      isPlatformAdmin: true,
    };
  }

  let user;
  try {
    user = await requireSession();
  } catch {
    return {
      success: false,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!user.isSuperAdmin) {
    return {
      success: false,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { success: true, user, isPlatformAdmin: false };
}

export async function getSuperAdminOrNull(): Promise<SuperAdminActor | null> {
  const auth = await requireSuperAdmin();
  if (!auth.success) return null;
  return { user: auth.user, isPlatformAdmin: auth.isPlatformAdmin };
}
