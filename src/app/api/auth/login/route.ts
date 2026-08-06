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
  const rl = await rateLimit(`login:${ip}`, 10, 60_000);
  if (!rl.success) {
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

  const { email, password } = parsed.data;
  const user = await db.businessUser.findUnique({
    where: { email: email.toLowerCase() },
    include: { business: true },
  });
  if (!user || !(await bcrypt.compare(password, user.password))) {
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
