import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { requireQuota } from "@/lib/plan-quota";

const TEMPLATE_TYPES = [
  "website_dev", "software_dev", "ai_chatbot", "cloud_hosting",
  "cybersecurity_audit", "website_maintenance", "isp_software",
  "construction_erp", "custom",
];

// GET /api/proposal-templates — list templates (global + business-specific)
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || undefined;

    const where: any = {
      OR: [{ businessId: null }, { businessId: user.businessId }],
      isActive: true,
    };
    if (type) where.type = type;

    const templates = await db.proposalTemplate.findMany({
      where,
      orderBy: [{ businessId: "desc" }, { name: "asc" }],
    });

    return {
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        industry: t.industry,
        description: t.description,
        sections: JSON.parse(t.sections || "[]"),
        defaultItems: JSON.parse(t.defaultItems || "[]"),
        isGlobal: !t.businessId,
        isActive: t.isActive,
      })),
    };
  });
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  type: z.enum(TEMPLATE_TYPES as [string, ...string[]]),
  industry: z.string().max(100).optional(),
  description: z.string().max(500).optional().or(z.literal("")),
  sections: z.array(z.string()).optional(),
  defaultItems: z.array(z.object({
    description: z.string(),
    quantity: z.number().min(1).default(1),
    unitPrice: z.number().min(0).default(0),
  })).optional(),
});

// POST /api/proposal-templates — create a business-specific template
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const d = parsed.data;
    await requireQuota(user.businessId, "proposalTemplates");

    const template = await db.proposalTemplate.create({
      data: {
        businessId: user.businessId,
        name: d.name.trim(),
        type: d.type,
        industry: d.industry || null,
        description: d.description?.trim() || null,
        sections: JSON.stringify(d.sections || []),
        defaultItems: JSON.stringify(d.defaultItems || []),
        isActive: true,
      },
    });

    return { template };
  });
}
