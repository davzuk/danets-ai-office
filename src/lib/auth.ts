import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

export const SESSION_COOKIE = "danets_session";
export const IMPERSONATOR_COOKIE = "danets_impersonator";
const SESSION_TTL_DAYS = 7;

export interface SessionUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
  isSuperAdmin: boolean;
  isImpersonating?: boolean;
  isPlatformAdmin?: boolean;
  totpEnabled?: boolean;
}

function generateToken() {
  return randomBytes(32).toString("hex");
}

export async function createSession(userId: string, businessId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { token, businessUserId: userId, businessId, expiresAt },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(IMPERSONATOR_COOKIE);
}

export async function isImpersonating(): Promise<boolean> {
  const cookieStore = await cookies();
  return !!cookieStore.get(IMPERSONATOR_COOKIE)?.value;
}

export async function startImpersonation(targetUserId: string, targetBusinessId: string) {
  const cookieStore = await cookies();
  const currentToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!currentToken) throw new Error("UNAUTHORIZED");

  const currentSession = await db.session.findUnique({
    where: { token: currentToken },
    include: { businessUser: true },
  });
  if (!currentSession?.businessUser.isSuperAdmin) {
    throw new Error("FORBIDDEN");
  }

  const target = await db.businessUser.findUnique({
    where: { id: targetUserId },
    select: { id: true, businessId: true, isSuperAdmin: true },
  });
  if (!target || target.businessId !== targetBusinessId) {
    throw new Error("NOT_FOUND");
  }
  if (target.isSuperAdmin) {
    throw new Error("CANNOT_IMPERSONATE_SUPER_ADMIN");
  }

  const expiresAt = currentSession.expiresAt;
  cookieStore.set(IMPERSONATOR_COOKIE, currentToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  await createSession(targetUserId, targetBusinessId);
}

export async function exitImpersonation() {
  const cookieStore = await cookies();
  const impersonatorToken = cookieStore.get(IMPERSONATOR_COOKIE)?.value;
  if (!impersonatorToken) throw new Error("NOT_IMPERSONATING");

  const currentToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (currentToken) {
    await db.session.deleteMany({ where: { token: currentToken } }).catch(() => {});
  }

  const saSession = await db.session.findUnique({ where: { token: impersonatorToken } });
  if (!saSession || saSession.expiresAt < new Date()) {
    cookieStore.delete(IMPERSONATOR_COOKIE);
    cookieStore.delete(SESSION_COOKIE);
    throw new Error("EXPIRED");
  }

  cookieStore.set(SESSION_COOKIE, impersonatorToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: saSession.expiresAt,
  });
  cookieStore.delete(IMPERSONATOR_COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: {
      businessUser: { include: { business: true } },
    },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const u = session.businessUser;
  const impersonating =
    !!cookieStore.get(IMPERSONATOR_COOKIE)?.value ||
    !!cookieStore.get("danets_platform_impersonator")?.value;
  return {
    userId: u.id,
    businessId: u.businessId,
    name: u.name,
    email: u.email,
    role: u.role,
    businessName: u.business.name,
    isSuperAdmin: impersonating ? false : u.isSuperAdmin,
    isImpersonating: impersonating,
  };
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");

  // Super admins can operate across tenants even if their "home" business
  // is suspended — they manage the platform itself.
  if (!s.isSuperAdmin) {
    const business = await db.business.findUnique({
      where: { id: s.businessId },
      select: { status: true },
    });
    if (business?.status === "suspended") {
      throw new Error("SUSPENDED");
    }
  }

  return s;
}
