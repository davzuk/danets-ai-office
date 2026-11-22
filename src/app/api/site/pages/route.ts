import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { createPage } from "@/lib/sites/service";

const schema = z.object({
  title: z.string().trim().min(1, "Give the page a title").max(200),
  slug: z.string().trim().max(120),
  template: z.enum(["blank", "home"]).default("blank"),
});

// POST /api/site/pages: a new draft page.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid page", { status: 400, code: "INVALID_INPUT" });
    const business = await db.business.findUnique({ where: { id: user.businessId }, select: { name: true } });
    const page = await createPage({ businessId: user.businessId, userId: user.userId, name: user.name }, parsed.data, business?.name ?? "");
    return { page: { id: page.id, slug: page.slug, title: page.title, status: page.status } };
  });
}
