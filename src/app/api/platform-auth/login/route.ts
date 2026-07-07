import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  createPlatformSession,
  destroyPlatformSession,
  toPlatformSessionUser,
} from "@/lib/platform-auth";
import { destroySession } from "@/lib/auth";
import { verifyTotpCode } from "@/lib/totp";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  totpCode: z.string().optional(),
});

// POST /api/platform-auth/login — dedicated platform admin login
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`platform-login:${ip}`, 8, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const admin = await db.platformAdmin.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.password))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (admin.totpEnabled) {
    if (!parsed.data.totpCode) {
      return NextResponse.json({ requiresTotp: true, email: admin.email });
    }
    if (!admin.totpSecret || !(await verifyTotpCode(admin.totpSecret, parsed.data.totpCode))) {
      return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
    }
  }

  await destroySession();
  await destroyPlatformSession();
  await createPlatformSession(admin.id);

  const user = await toPlatformSessionUser(admin);

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: "platform_login",
    module: "auth",
    description: `Platform admin ${admin.email} signed in`,
  });

  return NextResponse.json({ user, isPlatformAdmin: true });
}
