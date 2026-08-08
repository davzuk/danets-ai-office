import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({ email: z.string().email() });
const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`platform-forgot:${ip}`, 5, 60_000);
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

  const admin = await db.platformAdmin.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  if (admin) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await db.platformPasswordResetToken.updateMany({
      where: { adminId: admin.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await db.platformPasswordResetToken.create({
      data: { adminId: admin.id, tokenHash, expiresAt },
    });

    const resetUrl = `${getOrigin(req)}/platform/reset-password?token=${token}`;
    logger.info("platform password reset", { email: admin.email });

    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_MODE !== "false") {
      logger.info("[dev] platform reset URL", { resetUrl });
    }

    void sendResetEmail(admin.email, resetUrl).catch((e) =>
      logger.error("platform forgot-password email failed", { err: String(e) })
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "If a platform admin account exists for that email, a reset link has been sent.",
  });
}

function getOrigin(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

async function sendResetEmail(to: string, resetUrl: string) {
  const provider = process.env.EMAIL_PROVIDER || "none";
  if (provider === "none") return;
  const { sendEmail } = await import("@/lib/email");
  await sendEmail({
    to,
    subject: "Reset your Danets platform admin password",
    html: `<p><a href="${resetUrl}">Reset your platform admin password</a>. This link expires in 1 hour.</p>`,
    text: `Reset your platform admin password: ${resetUrl} (expires in 1 hour)`,
  });
}