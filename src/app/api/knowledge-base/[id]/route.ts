import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const updateSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(200).optional(),
  content: z.string().min(1, "Content is required").optional(),
  category: z.string().min(1).max(80).optional(),
  sourceType: z.enum(["manual", "faq", "doc", "url"]).optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
});

async function getOwnedItem(id: string, businessId: string) {
  const item = await db.knowledgeBaseItem.findUnique({ where: { id } });
  // Always verify ownership — both missing items and items belonging to
  // other businesses map to FORBIDDEN so we don't leak existence.
  if (!item || item.businessId !== businessId) {
    throw new Error("FORBIDDEN");
  }
  return item;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;
    const item = await getOwnedItem(id, user.businessId);
    return { item };
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;
    const existing = await getOwnedItem(id, user.businessId);

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first?.message || "Invalid input");
    }

    const data = parsed.data;
    // Normalize category: empty string -> keep default ("General")
    if (data.category !== undefined && data.category.trim() === "") {
      data.category = "General";
    }

    const updated = await db.knowledgeBaseItem.update({
      where: { id: existing.id },
      data,
    });

    return { item: updated };
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;
    const existing = await getOwnedItem(id, user.businessId);

    await db.knowledgeBaseItem.delete({ where: { id: existing.id } });

    return { success: true, id: existing.id };
  });
}
