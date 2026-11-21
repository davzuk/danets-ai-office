import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { destroyPlatformSession } from "@/lib/platform-auth";
import { logActivity } from "@/lib/activity";
import { consumeBackupCode, verifyTotpCode } from "@/lib/totp";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  totpCode: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Two independent rate limits:
  //   - login:${ip}: standard per-IP brute-force defence
  //   - login:${ip}:${email}: per-(ip,email) pair to slow down botnets
  //     that rotate IPs but stick to a single email.
  const ipRl = await rateLimit(`login:${ip}`, 10, 60_000);
  if (!ipRl.success) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { email } = parsed.data;
  const emailLower = email.toLowerCase();

  // Per-(ip, email) limit: 10 attempts in 5 minutes.
  const pairRl = await rateLimit(`login:${ip}:${emailLower}`, 10, 5 * 60_000);
  if (!pairRl.success) {
    await recordAttempt(ip, emailLower, null, false, req.headers.get("user-agent"));
    return NextResponse.json(
      { error: "Too many attempts for this account. Try again later." },
      { status: 429 }
    );
  }

  // Per-account lockout: 25 failed attempts in 15 min.
  const lockedUntil = await isAccountLocked(emailLower);
  if (lockedUntil) {
    return NextResponse.json(
      {
        error: `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil((lockedUntil.getTime() - Date.now()) / 60000)} minutes.`,
      },
      { status: 429 }
    );
  }

  const { password } = parsed.data;
  const user = await db.businessUser.findUnique({
    where: { email: emailLower },
    include: { business: true },
  });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    await recordAttempt(ip, emailLower, user?.businessId ?? null, false, req.headers.get("user-agent"));
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (user.business.status !== "active") {
    return NextResponse.json({ error: "Business suspended" }, { status: 403 });
  }

  // 2FA gate: per-user opt-in OR tenant policy (Business.enforce2fa).
  // If policy requires 2FA but the user has never set it up, force the
  // setup flow before issuing a session.
  const requiresTotp = user.totpEnabled || user.business.enforce2fa;
  let usedBackupCode = false;
  if (requiresTotp) {
    if (!user.totpSecret) {
      // Policy says 2FA is mandatory, but the user hasn't enrolled yet.
      // Return a dedicated code so the auth screen can redirect to setup.
      return NextResponse.json({
        requiresTotpSetup: true,
        email: user.email,
        reason: user.business.enforce2fa && !user.totpEnabled
          ? "tenant_policy"
          : "user_opt_in",
      });
    }
    if (!parsed.data.totpCode) {
      return NextResponse.json({ requiresTotp: true, email: user.email });
    }
    // Accept either a fresh 6-digit TOTP or a one-time backup code. The
    // backup code path is a fallback for users who have lost access to
    // their authenticator device — see `consumeBackupCode` in totp.ts.
    const totpValid = await verifyTotpCode(user.totpSecret, parsed.data.totpCode);
    if (!totpValid) {
      const backupOk = await consumeBackupCode(db, user.id, parsed.data.totpCode);
      if (!backupOk) {
        return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
      }
      usedBackupCode = true;
    }
  }

  await destroyPlatformSession();
  await createSession(user.id, user.businessId);

  await recordAttempt(ip, emailLower, user.businessId, true, req.headers.get("user-agent"));

  await logActivity({
    businessId: user.businessId,
    userId: user.id,
    userName: user.name,
    action: "login",
    module: "auth",
    description: `${user.name} signed in${usedBackupCode ? " (via backup code)" : ""}`,
    metadata: usedBackupCode ? { viaBackupCode: true } : undefined,
  });

  return NextResponse.json({
    user: {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessId: user.businessId,
      businessName: user.business.name,
      isSuperAdmin: user.isSuperAdmin,
      totpEnabled: user.totpEnabled,
    },
  });
}

/**
 * Record a login attempt. Best-effort: failures here must not break login.
 */
async function recordAttempt(
  ip: string,
  email: string,
  businessId: string | null,
  succeeded: boolean,
  userAgent: string | null
) {
  try {
    await db.loginAttempt.create({
      data: {
        ip,
        email,
        businessId: businessId ?? null,
        succeeded,
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });
  } catch {
    /* swallow — logging must not block login */
  }
}

/**
 * Returns the Date until which the account is locked, or null if not locked.
 * A lock is triggered by 25+ failed attempts in a 15-minute window.
 */
async function isAccountLocked(email: string): Promise<Date | null> {
  const windowMs = 15 * 60_000;
  const since = new Date(Date.now() - windowMs);
  const failures = await db.loginAttempt.count({
    where: { email, succeeded: false, attemptedAt: { gt: since } },
  });
  if (failures < 25) return null;

  // Find the 25th-most-recent failure and lock until 15 min after it.
  const recent = await db.loginAttempt.findMany({
    where: { email, succeeded: false, attemptedAt: { gt: since } },
    orderBy: { attemptedAt: "desc" },
    skip: 24,
    take: 1,
    select: { attemptedAt: true },
  });
  if (recent.length === 0) return null;
  return new Date(recent[0].attemptedAt.getTime() + windowMs);
}
