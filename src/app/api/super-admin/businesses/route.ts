import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { getTenantUsage } from "@/lib/tenant-usage";

const createSchema = z.object({
  businessName: z.string().min(2).max(120),
  industry: z.string().max(120).optional(),
  email: z.string().email().optional(),
  plan: z.enum(["free", "starter", "pro", "enterprise"]).default("free"),
  adminName: z.string().min(2).max(80),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6).max(100),
});

// GET /api/super-admin/businesses — list all businesses with stats
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const plan = searchParams.get("plan") || undefined;
  const status = searchParams.get("status") || undefined;

  const where: any = {};
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
    ];
  }
  if (plan) where.plan = plan;
  if (status) where.status = status;

  const businesses = await db.business.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      industry: true,
      plan: true,
      status: true,
      publicKey: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          leads: true,
          chatSessions: true,
          supportTickets: true,
          quoteRequests: true,
          usageLogs: true,
        },
      },
    },
  });

  // Get AI usage per business
  const businessIds = businesses.map((b) => b.id);
  const aiUsage = await db.aiUsageLog.groupBy({
    by: ["businessId"],
    where: { businessId: { in: businessIds } },
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
  });
  const aiMap = new Map(aiUsage.map((a) => [a.businessId, a]));

  return NextResponse.json({
    businesses: businesses.map((b) => {
      const ai = aiMap.get(b.id);
      return {
        id: b.id,
        name: b.name,
        email: b.email,
        industry: b.industry,
        plan: b.plan,
        status: b.status,
        publicKey: b.publicKey,
        createdAt: b.createdAt.toISOString(),
        stats: {
          users: b._count.users,
          leads: b._count.leads,
          chats: b._count.chatSessions,
          tickets: b._count.supportTickets,
          proposals: b._count.quoteRequests,
          aiRequests: b._count.usageLogs,
        },
        aiUsage: ai
          ? {
              tokens: ai._sum.totalTokens || 0,
              costUsd: ai._sum.costUsd || 0,
              requests: ai._count,
            }
          : { tokens: 0, costUsd: 0, requests: 0 },
      };
    }),
  });
}

// POST /api/super-admin/businesses — create a new tenant
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const {
    businessName,
    industry,
    email,
    plan,
    adminName,
    adminEmail,
    adminPassword,
  } = parsed.data;

  const existing = await db.businessUser.findUnique({
    where: { email: adminEmail.toLowerCase() },
  });
  if (existing) {
    return NextResponse.json({ error: "Admin email already registered" }, { status: 409 });
  }

  const planRow = await db.subscriptionPlan.findUnique({
    where: { name: plan },
    select: { priceUsd: true },
  });

  const result = await db.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: businessName.trim(),
        industry: industry?.trim() || null,
        email: email?.toLowerCase() || adminEmail.toLowerCase(),
        plan,
        status: "active",
      },
    });

    const adminUser = await tx.businessUser.create({
      data: {
        businessId: business.id,
        name: adminName.trim(),
        email: adminEmail.toLowerCase(),
        password: await bcrypt.hash(adminPassword, 10),
        role: "admin",
      },
    });

    await tx.aiAgent.create({
      data: {
        businessId: business.id,
        botName: "Assistant",
        businessName: business.name,
        industry: industry || "General",
        welcomeMessage: "Hi! How can I help you today?",
        fallbackMessage:
          "I'm not fully sure about that. Please contact our team for confirmation.",
        handoverMessage: "Let me connect you with our team for further assistance.",
        tone: "professional",
        brandColor: "#1d4ed8",
        status: "active",
      },
    });

    await tx.businessSubscription.create({
      data: {
        businessId: business.id,
        planName: plan,
        status: "active",
        monthlyFee: planRow?.priceUsd ?? 0,
      },
    });

    return { business, adminUser };
  });

  await logActivity({
    businessId: result.business.id,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "tenant_created",
    module: "business",
    description: `Super admin created tenant "${result.business.name}" with admin ${result.adminUser.email}`,
    metadata: { plan, createdBy: user.email },
  });

  return NextResponse.json({
    business: {
      id: result.business.id,
      name: result.business.name,
      email: result.business.email,
      plan: result.business.plan,
      status: result.business.status,
      createdAt: result.business.createdAt.toISOString(),
    },
    admin: {
      id: result.adminUser.id,
      name: result.adminUser.name,
      email: result.adminUser.email,
    },
  });
}
