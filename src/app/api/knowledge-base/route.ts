import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const createSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(200),
  content: z.string().min(1, "Content is required"),
  category: z.string().min(1).max(80).default("General"),
  sourceType: z.enum(["manual", "faq", "doc", "url"]).default("manual"),
  status: z.enum(["active", "draft", "archived"]).default("active"),
});

export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || undefined;
    const status = searchParams.get("status") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;

    const where: any = { businessId: user.businessId };
    if (category) where.category = category;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
      ];
    }

    const items = await db.knowledgeBaseItem.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        sourceType: true,
        status: true,
        views: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { items };
  });
}

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first?.message || "Invalid input");
    }

    const item = await db.knowledgeBaseItem.create({
      data: {
        businessId: user.businessId,
        title: parsed.data.title,
        content: parsed.data.content,
        category: parsed.data.category,
        sourceType: parsed.data.sourceType,
        status: parsed.data.status,
      },
    });

    return { item };
  });
}
