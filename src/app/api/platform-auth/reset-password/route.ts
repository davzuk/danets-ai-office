import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(32),
  newPassword: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`platform-reset:${ip}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input. Passwords must be at least 8 characters." },
      { status: 400 }
    );
  }

  const tokenHash = createHash("sha256")
    .update(parsed.data.token)
    .digest("hex");
  const now = new Date();

  const claimed = await db.platformPasswordResetToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  const row = await db.platformPasswordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!row) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.$transaction([
    db.platformAdmin.update({
      where: { id: row.adminId },
      data: { password: newHash },
    }),
    db.platformSession.deleteMany({ where: { platformAdminId: row.adminId } }),
  ]);

  return NextResponse.json({
    success: true,
    message: "Password updated. Sign in with your new password.",
  });
}