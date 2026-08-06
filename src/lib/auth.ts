import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { enforceSubscriptionAccess } from "@/lib/subscription-access";
import { enforceModuleAccess } from "@/lib/module-access";
import { getPlatformConfig } from "@/lib/platform-config";
import { ensureCsrfForSession, verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";

export const SESSION_COOKIE = "danets_session";
export const IMPERSONATOR_COOKIE = "danets_impersonator";

// Hard cap regardless of activity — session is rejected past this point.
const SESSION_TTL_DAYS = 7;
// Sliding window: requireSession updates lastSeenAt each call; if the gap
// from lastSeenAt to "now" exceeds this, the session is treated as idle.
const IDLE_TIMEOUT_MINUTES = 30;
// On every authenticated request we touch lastSeenAt; only rotate the
// actual cookie+DB token (which is expensive — CSRF re-mint, cookie write)
// when the prior rotation was at least this long ago.
const REFRESH_ROTATE_MINUTES = 15;

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

function minutesAgo(date: Date | null | undefined): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (Date.now() - date.getTime()) / 60_000;
}

export async function createSession(userId: string, businessId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const session = await db.session.create({
    data: {
      token,
      businessUserId: userId,
      businessId,
      expiresAt,
      absoluteExpiresAt: expiresAt,
      lastSeenAt: now,
    },
  });
  // Mint a CSRF token and bind it to the cookie. Browser JS will read this
  // cookie (non-httpOnly) and echo it via x-csrf-token on every mutating
  // request; the server compares against the value persisted on the session
  // row to defeat cross-site form forgery.
  await ensureCsrfForSession(session.id, expiresAt);
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

/**
 * Update `lastSeenAt` to "now" without rotating. Cheap — used on every
 * authenticated request.
 */
export async function touchSession(sessionId: string): Promise<void> {
  await db.session
    .update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
}

/**
 * Rotate the session token + CSRF token when the prior rotation is stale.
 * Returns the new token if rotation occurred; returns null otherwise.
 * Throws "UNAUTHORIZED" / "EXPIRED" when the session must be killed.
 */
export async function rotateSessionIfStale(
  session: {
    id: string;
    token: string;
    businessUserId: string;
    businessId: string;
    absoluteExpiresAt: Date;
    lastSeenAt: Date | null;
    csrfToken: string | null;
  }
): Promise<string | null> {
  // Idle timeout — sign the user out if they went away too long.
  if (minutesAgo(session.lastSeenAt) > IDLE_TIMEOUT_MINUTES) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    logger.info("session idle timeout — destroyed", { sessionId: session.id });
    throw new Error("UNAUTHORIZED");
  }
  // Absolute timeout — even active sessions must die.
  if (session.absoluteExpiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    logger.info("session absolute timeout — destroyed", { sessionId: session.id });
    throw new Error("EXPIRED");
  }
  // Cheap path — just extend the window, don't mint a new token.
  if (minutesAgo(session.lastSeenAt) < REFRESH_ROTATE_MINUTES) {
    return null;
  }
  // Expensive rotation: new token, new CSRF, new cookie. The old row is
  // replaced atomically — a request that uses the old token will 401
  // (acceptable: a single-tab product; multi-tab is documented as a known
  // limitation in the P10 plan).
  const newToken = generateToken();
  const now = new Date();
  const newExpires = session.absoluteExpiresAt; // keep the absolute cap
  const created = await db.$transaction(async (tx) => {
    await tx.session.delete({ where: { id: session.id } });
    return tx.session.create({
      data: {
        token: newToken,
        businessUserId: session.businessUserId,
        businessId: session.businessId,
        expiresAt: newExpires,
        absoluteExpiresAt: newExpires,
        lastSeenAt: now,
      },
    });
  });
  await ensureCsrfForSession(created.id, newExpires);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: newExpires,
  });
  logger.info("session rotated", { sessionId: created.id });
  return newToken;
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
  // Honor the absolute cap (we never extend the hard deadline) and the
  // legacy rolling-deadline column so rows written before this migration
  // keep working.
  const now = new Date();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Idle window — best-effort: the authoritative check is rotateSessionIfStale
  // which throws "UNAUTHORIZED". getSession is read-only, so we just return
  // the user and let requireSession enforce.
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
    totpEnabled: u.totpEnabled,
  };
}

export async function requireSession(): Promise<SessionUser> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) throw new Error("UNAUTHORIZED");

  // Pull the full row — we need csrfToken, businessUserId, businessId,
  // lastSeenAt, absoluteExpiresAt for the rotation/touch logic.
  const session = await db.session.findUnique({
    where: { token: sessionToken },
    include: {
      businessUser: { include: { business: true } },
    },
  });
  if (!session) throw new Error("UNAUTHORIZED");

  const now = new Date();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new Error("UNAUTHORIZED");
  }

  // Rotate or touch. Throws "UNAUTHORIZED" / "EXPIRED" when the session
  // must be killed — both bubble up to apiHandler as the standard failure.
  // When rotation happens a fresh row is created, so we only fall through
  // to touchSession when there was no rotation (returned token === null).
  const rotated = await rotateSessionIfStale({
    id: session.id,
    token: session.token,
    businessUserId: session.businessUserId,
    businessId: session.businessId,
    absoluteExpiresAt: session.absoluteExpiresAt,
    lastSeenAt: session.lastSeenAt,
    csrfToken: session.csrfToken,
  });
  if (rotated === null) {
    await touchSession(session.id);
  }

  const u = session.businessUser;
  const impersonating =
    !!cookieStore.get(IMPERSONATOR_COOKIE)?.value ||
    !!cookieStore.get("danets_platform_impersonator")?.value;
  const s: SessionUser = {
    userId: u.id,
    businessId: u.businessId,
    name: u.name,
    email: u.email,
    role: u.role,
    businessName: u.business.name,
    isSuperAdmin: impersonating ? false : u.isSuperAdmin,
    isImpersonating: impersonating,
    totpEnabled: u.totpEnabled,
  };

  const platformConfig = await getPlatformConfig();
  if (platformConfig.maintenanceMode && !s.isImpersonating) {
    throw new Error("MAINTENANCE");
  }

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

    const h = await headers();
    const method = h.get("x-danets-method") || "GET";
    const pathname = h.get("x-danets-pathname") || "";
    await enforceSubscriptionAccess(s.businessId, { method, pathname });
    await enforceModuleAccess(s.businessId, pathname);
  }

  // CSRF: require a matching token on every unsafe request, except those
  // explicitly exempted (webhooks, public widget, auth endpoints). Throws
  // CSRF_INVALID if the header / cookie / DB token don't all align.
  // After a rotation the cookie + DB token both point at the freshly-minted
  // value; verifyCsrf does the constant-time comparison.
  await verifyCsrf(session.csrfToken ?? null);

  return s;
}
