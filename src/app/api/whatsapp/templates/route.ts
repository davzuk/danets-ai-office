import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/whatsapp/templates — list templates
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || undefined;

    const where: any = { businessId: user.businessId };
    if (type) where.type = type;

    const templates = await db.whatsAppTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return {
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        content: t.content,
        isActive: t.isActive,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  });
}

const TEMPLATE_TYPES = [
  "new_lead_followup", "missed_chat", "quotation_followup",
  "payment_reminder", "appointment_confirmation", "ticket_update", "custom",
];

const createSchema = z.object({
  name: z.string().min(2).max(100),
  type: z.enum(TEMPLATE_TYPES as [string, ...string[]]),
  content: z.string().min(1).max(2000),
  isActive: z.boolean().default(true),
});

// POST /api/whatsapp/templates — create a template
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const template = await db.whatsAppTemplate.create({
      data: {
        businessId: user.businessId,
        name: parsed.data.name.trim(),
        type: parsed.data.type,
        content: parsed.data.content,
        isActive: parsed.data.isActive,
      },
    });

    return { template };
  });
}
