import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { deletePage, getPageOrThrow, publishPage, restoreVersion, savePage, unpublishPage } from "@/lib/sites/service";
import { loadSite, pageView, withPlatformAdmin } from "@/lib/sites/platform";

type Ctx = { params: Promise<{ id: string; pageId: string }> };

async function load(params: Ctx["params"], admin: Parameters<typeof loadSite>[1]) {
  const { id, pageId } = await params;
  const { site, actor } = await loadSite(id, admin);
  const page = await getPageOrThrow(site.businessId, pageId);
  if (page.siteId !== site.id) throw new AppError("Page not found.", { status: 404, code: "NOT_FOUND" });
  return { site, actor, page };
}

// GET /api/super-admin/sites/<id>/pages/<pageId>: one page's draft, with its
// published versions (newest first).
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPlatformAdmin(async (admin) => {
    const { page } = await load(params, admin);
    const versions = await db.landingPageVersion.findMany({
      where: { pageId: page.id },
      select: { id: true, title: true, publishedBy: true, restoredFrom: true, createdAt: true, blocks: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      page: pageView(page),
      versions: versions.map((v, i) => ({
        id: v.id,
        title: v.title,
        publishedBy: v.publishedBy,
        restoredFrom: v.restoredFrom,
        createdAt: v.createdAt,
        blockCount: Array.isArray(v.blocks) ? v.blocks.length : 0,
        live: i === 0 && page.status === "published",
      })),
    };
  });
}

// PATCH: save the draft (title, slug, blocks, SEO).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPlatformAdmin(async (admin) => {
    const { actor, page } = await load(params, admin);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const saved = await savePage(actor, page.id, {
      title: typeof body?.title === "string" ? body.title : undefined,
      slug: typeof body?.slug === "string" ? body.slug : undefined,
      blocks: body && "blocks" in body ? body.blocks : undefined,
      seo: body && "seo" in body ? body.seo : undefined,
    });
    return { page: pageView(saved) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPlatformAdmin(async (admin) => {
    const { actor, page } = await load(params, admin);
    await deletePage(actor, page.id);
    return { ok: true };
  });
}

const actionSchema = z.union([
  z.object({ action: z.enum(["publish", "unpublish"]) }),
  z.object({ action: z.literal("restore"), versionId: z.string().min(1).max(40) }),
]);

// POST {action: publish | unpublish | restore(versionId)}.
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPlatformAdmin(async (admin) => {
    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Unknown action", { status: 400, code: "INVALID_INPUT" });
    const { actor, page } = await load(params, admin);
    const a = parsed.data;
    const updated =
      a.action === "restore" ? await restoreVersion(actor, page.id, a.versionId) : a.action === "publish" ? await publishPage(actor, page.id) : await unpublishPage(actor, page.id);
    return { page: pageView(updated) };
  });
}
