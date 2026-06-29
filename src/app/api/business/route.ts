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
});

export async function PUT(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }
    const data: any = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.industry !== undefined) data.industry = parsed.data.industry;
    if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
    if (parsed.data.phone !== undefined) data.phone = parsed.data.phone || null;
    if (parsed.data.whatsapp !== undefined) data.whatsapp = parsed.data.whatsapp || null;

    const updated = await db.business.update({
      where: { id: user.businessId },
      data,
      select: { id: true, name: true, industry: true, email: true, phone: true, whatsapp: true, publicKey: true },
    });
    return { business: updated };
  });
}
