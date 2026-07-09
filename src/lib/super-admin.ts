import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getPlatformSession,
  platformAsSessionUser,
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
    return {
      success: true,
      user: platformAsSessionUser(platform),
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
