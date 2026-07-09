import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { destroyPlatformSession } from "@/lib/platform-auth";
import { logActivity } from "@/lib/activity";
import { verifyTotpCode } from "@/lib/totp";

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

  if (user.totpEnabled) {
    if (!parsed.data.totpCode) {
      return NextResponse.json({ requiresTotp: true, email: user.email });
    }
    if (
      !user.totpSecret ||
      !(await verifyTotpCode(user.totpSecret, parsed.data.totpCode))
    ) {
      return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
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
    description: `${user.name} signed in`,
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
