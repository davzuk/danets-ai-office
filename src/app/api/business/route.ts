import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const business = await db.business.findUnique({
      where: { id: user.businessId },
      select: {
        id: true,
        name: true,
        publicKey: true,
        industry: true,
        email: true,
        phone: true,
        whatsapp: true,
        plan: true,
        status: true,
        enforce2fa: true,
        createdAt: true,
      },
    });
    const plan = await db.subscriptionPlan.findUnique({
      where: { name: business?.plan || "free" },
    });
    const counts = {
      agents: await db.aiAgent.count({ where: { businessId: user.businessId } }),
      kbItems: await db.knowledgeBaseItem.count({ where: { businessId: user.businessId } }),
      sessions: await db.chatSession.count({ where: { businessId: user.businessId } }),
      leads: await db.lead.count({ where: { businessId: user.businessId } }),
    };
    return { business, plan, counts };
  });
}

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  industry: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  whatsapp: z.string().max(40).optional().or(z.literal("")),
  // Tenant-level 2FA policy toggle. Only admins may flip this — enforced
  // here so the business PUT endpoint is the single source of truth.
  enforce2fa: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") {
      throw new Error("FORBIDDEN");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }
    const data: any = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.industry !== undefined) data.industry = parsed.data.industry;
    if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
    if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
    if (parsed.data.whatsapp !== undefined) data.whatsapp = parsed.data.whatsapp || null;
    if (parsed.data.enforce2fa !== undefined) {
      data.enforce2fa = parsed.data.enforce2fa;
    }

    const updated = await db.business.update({
      where: { id: user.businessId },
      data,
      select: {
        id: true,
        name: true,
        industry: true,
        email: true,
        phone: true,
        whatsapp: true,
        publicKey: true,
        enforce2fa: true,
      },
    });
    return { business: updated };
  });
}
