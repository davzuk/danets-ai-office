import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlatformSession } from "@/lib/platform-auth";
import { generateTotpSecret, getTotpUri, verifyTotpCode } from "@/lib/totp";

// GET /api/platform-auth/totp/setup — begin 2FA setup
export async function GET() {
  let admin;
  try {
    admin = await requirePlatformSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await db.platformAdmin.findUnique({ where: { id: admin.platformAdminId } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.totpEnabled) {
    return NextResponse.json({ error: "2FA already enabled" }, { status: 400 });
  }

  const secret = generateTotpSecret();
  await db.platformAdmin.update({
    where: { id: row.id },
    data: { totpPending: secret },
  });

  return NextResponse.json({
    secret,
    otpauthUrl: getTotpUri(row.email, secret),
  });
}

const enableSchema = z.object({ code: z.string().min(6).max(8) });

// POST /api/platform-auth/totp/setup — confirm 2FA with verification code
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requirePlatformSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = enableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const row = await db.platformAdmin.findUnique({ where: { id: session.platformAdminId } });
  if (!row?.totpPending) {
    return NextResponse.json({ error: "No pending 2FA setup" }, { status: 400 });
  }
  if (!(await verifyTotpCode(row.totpPending, parsed.data.code))) {
    return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
  }

  await db.platformAdmin.update({
    where: { id: row.id },
    data: {
      totpSecret: row.totpPending,
      totpPending: null,
      totpEnabled: true,
    },
  });

  return NextResponse.json({ ok: true, totpEnabled: true });
}

const disableSchema = z.object({
  password: z.string().min(6),
  code: z.string().min(6).max(8),
});

// DELETE /api/platform-auth/totp/setup — disable 2FA
export async function DELETE(req: NextRequest) {
  let session;
  try {
    session = await requirePlatformSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password and 2FA code required" }, { status: 400 });
  }

  const row = await db.platformAdmin.findUnique({ where: { id: session.platformAdminId } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bcrypt = await import("bcryptjs");
  if (!(await bcrypt.compare(parsed.data.password, row.password))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  if (!row.totpSecret || !(await verifyTotpCode(row.totpSecret, parsed.data.code))) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
  }

  await db.platformAdmin.update({
    where: { id: row.id },
    data: { totpSecret: null, totpPending: null, totpEnabled: false },
  });

  return NextResponse.json({ ok: true, totpEnabled: false });
}
