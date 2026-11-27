import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createPage } from "@/lib/sites/service";
import { loadSite, withPlatformAdmin } from "@/lib/sites/platform";

const schema = z.object({
  title: z.string().trim().min(1, "Give the page a title").max(200),
  slug: z.string().trim().max(120),
  template: z.enum(["blank", "home"]).default("blank"),
});

// POST /api/super-admin/sites/<id>/pages: a new draft page.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformAdmin(async (admin) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid page", { status: 400, code: "INVALID_INPUT" });
    const { site, actor } = await loadSite((await params).id, admin);
    const business = await db.business.findUnique({ where: { id: site.businessId }, select: { name: true } });
    const page = await createPage(actor, parsed.data, business?.name ?? "");
    return { page: { id: page.id, slug: page.slug, title: page.title, status: page.status } };
  });
}
