import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import {
  generateBackupCodes,
  generateTotpSecret,
  getTotpUri,
  hashBackupCode,
  verifyTotpCode,
} from "@/lib/totp";

// Per-user rate limit on TOTP attempts: 5 per 10 minutes. The 6-digit TOTP
// space (10^6 = 1M codes) is large enough that 30/hour is well above any
// legitimate pattern but still throttles brute-force on a stolen cookie.
async function totpRateLimit(userId: string) {
  return rateLimit(`totp:${userId}`, 5, 10 * 60_000);
}

// GET /api/auth/totp/setup — begin tenant 2FA setup
export async function GET() {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await db.businessUser.findUnique({ where: { id: user.userId } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.totpEnabled) {
    return NextResponse.json({ error: "2FA already enabled" }, { status: 400 });
  }

  const secret = generateTotpSecret();
  await db.businessUser.update({
    where: { id: row.id },
    data: { totpPending: secret },
  });

  return NextResponse.json({
    secret,
    otpauthUrl: getTotpUri(row.email, secret),
  });
}

const enableSchema = z.object({ code: z.string().min(6).max(8) });

// POST /api/auth/totp/setup — confirm tenant 2FA
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ipRl = await rateLimit(`totp-ip:${getClientIp(req)}`, 20, 10 * 60_000);
  if (!ipRl.success) {
    return NextResponse.json(
      { error: "Too many 2FA attempts. Try again later." },
      { status: 429 }
    );
  }
  const rl = await totpRateLimit(session.userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many 2FA attempts. Try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = enableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const row = await db.businessUser.findUnique({ where: { id: session.userId } });
  if (!row?.totpPending) {
    return NextResponse.json({ error: "No pending 2FA setup" }, { status: 400 });
  }
  if (!(await verifyTotpCode(row.totpPending, parsed.data.code))) {
    return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
  }

  await db.businessUser.update({
    where: { id: row.id },
    data: {
      totpSecret: row.totpPending,
      totpPending: null,
      totpEnabled: true,
    },
  });

  // Mint a fresh batch of one-time backup codes. The cleartext codes are
  // returned in this response exactly once — the database only stores the
  // SHA-256 hashes, so a leaked DB row cannot be used to sign in.
  const backupCodes = generateBackupCodes(8);
  const backupCodeHashes = backupCodes.map(hashBackupCode);
  await db.businessUser.update({
    where: { id: row.id },
    data: { totpBackupCodes: backupCodeHashes as any },
  });

  return NextResponse.json({ ok: true, totpEnabled: true, backupCodes });
}

const disableSchema = z.object({
  password: z.string().min(6),
  code: z.string().min(6).max(8),
});

// DELETE /api/auth/totp/setup — disable tenant 2FA
export async function DELETE(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await totpRateLimit(session.userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many 2FA attempts. Try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password and 2FA code required" }, { status: 400 });
  }

  const row = await db.businessUser.findUnique({
    where: { id: session.userId },
    include: { business: { select: { enforce2fa: true } } },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Block disable when the tenant enforces 2FA. Mirrors the platform-level
  // "required by policy" guard on platform-auth's TOTP endpoint.
  if (row.business.enforce2fa) {
    return NextResponse.json(
      { error: "2FA is required by your organization's policy and cannot be disabled." },
      { status: 403 }
    );
  }

  const bcrypt = await import("bcryptjs");
  if (!(await bcrypt.compare(parsed.data.password, row.password))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  if (!row.totpSecret || !(await verifyTotpCode(row.totpSecret, parsed.data.code))) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
  }

  await db.businessUser.update({
    where: { id: row.id },
    data: {
      totpSecret: null,
      totpPending: null,
      totpEnabled: false,
      totpBackupCodes: Prisma.JsonNull,
    },
  });

  return NextResponse.json({ ok: true, totpEnabled: false });
}
