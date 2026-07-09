import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getPlatformConfig } from "@/lib/platform-config";

const schema = z.object({
  businessName: z.string().min(2).max(120),
  industry: z.string().optional(),
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`register:${ip}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { businessName, industry, name, email, password } = parsed.data;

  const platformConfig = await getPlatformConfig();
  if (!platformConfig.allowPublicSignup) {
    return NextResponse.json({ error: "Public registration is disabled" }, { status: 403 });
  }
  if (platformConfig.maintenanceMode) {
    return NextResponse.json({ error: "Platform is in maintenance mode" }, { status: 503 });
  }

  const existing = await db.businessUser.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const business = await db.business.create({
    data: {
      name: businessName,
      industry: industry || null,
      plan: platformConfig.defaultSignupPlan,
      status: "active",
    },
  });

  const user = await db.businessUser.create({
    data: {
      businessId: business.id,
      name,
      email: email.toLowerCase(),
      password: await bcrypt.hash(password, 10),
      role: "admin",
    },
  });

  // default AI agent
  await db.aiAgent.create({
    data: {
      businessId: business.id,
      botName: "Assistant",
      businessName: business.name,
      industry: industry || "General",
      welcomeMessage: "Hi! How can I help you today?",
      fallbackMessage:
        "I'm not fully sure about that. Please contact our team for confirmation.",
      handoverMessage:
        "Let me connect you with our team for further assistance.",
      tone: "professional",
      brandColor: "#1d4ed8",
      status: "active",
    },
  });

  await createSession(user.id, business.id);

  return NextResponse.json({
    user: {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessId: business.id,
      businessName: business.name,
      isSuperAdmin: user.isSuperAdmin,
    },
  });
}
