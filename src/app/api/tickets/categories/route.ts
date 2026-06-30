import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/tickets/categories — list ticket categories
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const categories = await db.supportTicketCategory.findMany({
      where: { businessId: user.businessId },
      orderBy: { name: "asc" },
      include: { _count: { select: { tickets: true } } },
    });
    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        color: c.color,
        ticketCount: c._count.tickets,
      })),
    };
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1d4ed8"),
});

// POST /api/tickets/categories — create a category
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }
    const category = await db.supportTicketCategory.create({
      data: {
        businessId: user.businessId,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        color: parsed.data.color,
      },
    });
    return { category };
  });
}
