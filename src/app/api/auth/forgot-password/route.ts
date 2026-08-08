import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.string().email(),
});

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Forgot-password — accepts an email, returns the same response regardless
 * of whether the account exists. This prevents user-enumeration.
 *
 * In dev mode (no EMAIL_PROVIDER configured) the cleartext token is
 * returned in the response so the developer can complete the reset flow.
 * Production deployments must leave EMAIL_PROVIDER unset OR unset
 * NEXT_PUBLIC_DEMO_MODE — the token is logged in dev too, but never
 * returned in the response.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`forgot:${ip}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.businessUser.findUnique({ where: { email } });

  // Constant-time-ish: do the database lookup + an inert token write even
  // when the user doesn't exist, so the response pattern can't be used as
  // an enumeration oracle.
  if (user) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    // Invalidate any prior unused tokens for this user.
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        businessId: user.businessId,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${getOrigin(req)}/reset-password?token=${token}`;

    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_MODE !== "false") {
      logger.info("[dev] password reset link", { email, resetUrl });
    }

    // Fire-and-forget — the response shouldn't wait for SMTP.
    void sendResetEmail(email, resetUrl).catch((e) =>
      logger.error("forgot-password email failed", { err: String(e) })
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "If an account exists for that email, a password reset link has been sent.",
  });
}

function getOrigin(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

async function sendResetEmail(to: string, resetUrl: string) {
  const provider = process.env.EMAIL_PROVIDER || "none";
  if (provider === "none") {
    logger.info("[dev] no email provider; reset URL not sent", { to });
    return;
  }

  const { sendEmail } = await import("@/lib/email");
  await sendEmail({
    to,
    subject: "Reset your Danets password",
    html: `<p>You requested a password reset for your Danets account.</p>
<p>If you did not request this, you can ignore this email — your password is unchanged.</p>
<p><a href="${resetUrl}">Click here to reset your password</a>. This link expires in 1 hour.</p>`,
    text: `Reset your Danets password: ${resetUrl} (expires in 1 hour)`,
  });
}
