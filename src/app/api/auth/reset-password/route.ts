import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyAnonymousCsrf } from "@/lib/csrf";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  token: z.string().min(32),
  newPassword: z.string().min(8).max(200),
});

/**
 * Reset-password — consumes a single-use token, sets a new password,
 * invalidates every existing session for the user (so a stolen session
 * from before the reset can't keep going).
 */
export async function POST(req: NextRequest) {
  // CSRF: without this check, an attacker site could submit a hidden form
  // with a stolen token (e.g. from a logged-out computer's clipboard) and
  // force a password reset. The browser must have hit /api/auth/csrf to
  // mint the cookie first.
  await verifyAnonymousCsrf();

  const ip = getClientIp(req);
  const rl = await rateLimit(`reset:${ip}`, 10, 60_000);
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

  // Atomically claim the token. Returns count=1 only on first valid call.
  const claimed = await db.passwordResetToken.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  // Look up the user via the (now-stamped) token. UpdateMany didn't return
  // a row id, so query by tokenHash directly.
  const tokenRow = await db.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10);

  // Update password + invalidate every session for this user, in one tx.
  await db.$transaction([
    db.businessUser.update({
      where: { id: tokenRow.userId },
      data: { password: newHash },
    }),
    db.session.deleteMany({ where: { businessUserId: tokenRow.userId } }),
  ]);

  await logActivity({
    businessId: tokenRow.businessId,
    userId: tokenRow.userId,
    userName: "(password reset)",
    action: "password_reset",
    module: "auth",
    description: "Password reset; all sessions invalidated.",
    metadata: {},
  });

  return NextResponse.json({
    success: true,
    message:
      "Password updated. Sign in with your new password. All existing sessions have been signed out.",
  });
}