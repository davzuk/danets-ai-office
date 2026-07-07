import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getPlatformSession,
  platformAsSessionUser,
  type PlatformAdminUser,
} from "@/lib/platform-auth";

export type SuperAdminActor = {
  user: {
    userId: string;
    businessId: string;
    name: string;
    email: string;
    role: string;
    businessName: string;
    isSuperAdmin: boolean;
    isPlatformAdmin?: boolean;
  };
  isPlatformAdmin: boolean;
};

export async function requireSuperAdmin(): Promise<
  SuperAdminActor | { error: NextResponse }
> {
  const platform = await getPlatformSession();
  if (platform) {
    return {
      user: platformAsSessionUser(platform),
      isPlatformAdmin: true,
    };
  }

  let user;
  try {
    user = await requireSession();
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!user.isSuperAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, isPlatformAdmin: false };
}

export async function getSuperAdminOrNull(): Promise<SuperAdminActor | null> {
  const platform = await getPlatformSession();
  if (platform) {
    return { user: platformAsSessionUser(platform), isPlatformAdmin: true };
  }
  try {
    const user = await requireSession();
    if (!user.isSuperAdmin) return null;
    return { user, isPlatformAdmin: false };
  } catch {
    return null;
  }
}
