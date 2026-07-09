import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import type { SessionUser } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/platform-config";

export const PLATFORM_SESSION_COOKIE = "danets_platform_session";
export const PLATFORM_IMPERSONATOR_COOKIE = "danets_platform_impersonator";
const SESSION_TTL_DAYS = 7;

export interface PlatformAdminUser {
  platformAdminId: string;
  userId: string;
  name: string;
  email: string;
  role: "platform_admin";
  businessId: string;
  businessName: string;
  isSuperAdmin: true;
  isPlatformAdmin: true;
  totpEnabled: boolean;
  isImpersonating?: boolean;
}

function generateToken() {
  return randomBytes(32).toString("hex");
}

export async function createPlatformSession(platformAdminId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.platformSession.create({
    data: { token, platformAdminId, expiresAt },
  });
  const cookieStore = await cookies();
  cookieStore.set(PLATFORM_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroyPlatformSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (token) {
    await db.platformSession.deleteMany({ where: { token } }).catch(() => {});
  }
  cookieStore.delete(PLATFORM_SESSION_COOKIE);
  cookieStore.delete(PLATFORM_IMPERSONATOR_COOKIE);
}

async function resolveHomeBusiness(admin: {
  homeBusinessId: string | null;
  email: string;
}) {
  if (admin.homeBusinessId) {
    const b = await db.business.findUnique({
      where: { id: admin.homeBusinessId },
      select: { id: true, name: true },
    });
    if (b) return b;
  }
  const fallback = await db.business.findFirst({
    where: { email: "hello@danetstecpro.com" },
    select: { id: true, name: true },
  });
  return fallback || { id: "platform", name: "Danets Platform" };
}

export async function toPlatformSessionUser(admin: {
  id: string;
  name: string;
  email: string;
  totpEnabled: boolean;
  homeBusinessId: string | null;
}): Promise<PlatformAdminUser> {
  const business = await resolveHomeBusiness(admin);
  return {
    platformAdminId: admin.id,
    userId: admin.id,
    name: admin.name,
    email: admin.email,
    role: "platform_admin",
    businessId: business.id,
    businessName: business.name,
    isSuperAdmin: true,
    isPlatformAdmin: true,
    totpEnabled: admin.totpEnabled,
  };
}

export async function getPlatformSession(): Promise<PlatformAdminUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.platformSession.findUnique({
    where: { token },
    include: { platformAdmin: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.platformSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const user = await toPlatformSessionUser(session.platformAdmin);
  user.isImpersonating = !!cookieStore.get(PLATFORM_IMPERSONATOR_COOKIE)?.value;
  return user;
}

export async function requirePlatformSession(): Promise<PlatformAdminUser> {
  const s = await getPlatformSession();
  if (!s) throw new Error("UNAUTHORIZED");

  const config = await getPlatformConfig();
  if (config.enforcePlatform2fa && !s.totpEnabled) {
    await destroyPlatformSession();
    throw new Error("PLATFORM_2FA_REQUIRED");
  }

  return s;
}

/** Map platform admin to SessionUser shape for shared super-admin route handlers. */
export function platformAsSessionUser(p: PlatformAdminUser): SessionUser & { isPlatformAdmin: true } {
  return {
    userId: p.userId,
    businessId: p.businessId,
    name: p.name,
    email: p.email,
    role: p.role,
    businessName: p.businessName,
    isSuperAdmin: true,
    isPlatformAdmin: true,
  };
}

export async function startPlatformImpersonation(targetUserId: string, targetBusinessId: string) {
  const cookieStore = await cookies();
  const platformToken = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!platformToken) throw new Error("UNAUTHORIZED");

  const platformSession = await db.platformSession.findUnique({
    where: { token: platformToken },
    include: { platformAdmin: true },
  });
  if (!platformSession) throw new Error("UNAUTHORIZED");

  const target = await db.businessUser.findUnique({
    where: { id: targetUserId },
    select: { id: true, businessId: true, isSuperAdmin: true },
  });
  if (!target || target.businessId !== targetBusinessId) throw new Error("NOT_FOUND");
  if (target.isSuperAdmin) throw new Error("CANNOT_IMPERSONATE_SUPER_ADMIN");

  cookieStore.set(PLATFORM_IMPERSONATOR_COOKIE, platformToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: platformSession.expiresAt,
  });
  cookieStore.delete(PLATFORM_SESSION_COOKIE);

  const { createSession } = await import("@/lib/auth");
  await createSession(targetUserId, targetBusinessId);
}

export async function exitPlatformImpersonation() {
  const cookieStore = await cookies();
  const impersonatorToken = cookieStore.get(PLATFORM_IMPERSONATOR_COOKIE)?.value;
  if (!impersonatorToken) throw new Error("NOT_IMPERSONATING");

  const currentToken = cookieStore.get("danets_session")?.value;
  if (currentToken) {
    await db.session.deleteMany({ where: { token: currentToken } }).catch(() => {});
  }
  cookieStore.delete("danets_session");

  const saSession = await db.platformSession.findUnique({ where: { token: impersonatorToken } });
  if (!saSession || saSession.expiresAt < new Date()) {
    cookieStore.delete(PLATFORM_IMPERSONATOR_COOKIE);
    cookieStore.delete(PLATFORM_SESSION_COOKIE);
    throw new Error("EXPIRED");
  }

  cookieStore.set(PLATFORM_SESSION_COOKIE, impersonatorToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: saSession.expiresAt,
  });
  cookieStore.delete(PLATFORM_IMPERSONATOR_COOKIE);
}
