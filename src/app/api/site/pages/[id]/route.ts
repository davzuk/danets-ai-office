import { NextRequest } from "next/server";
import type { LandingPage } from "@prisma/client";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { readBlocks, validateBlocks } from "@/lib/sites/blocks";
import { readPageSeo } from "@/lib/sites/server";
import { deletePage, getPageOrThrow, savePage } from "@/lib/sites/service";

type Ctx = { params: Promise<{ id: string }> };

function view(p: LandingPage) {
  const blocks = readBlocks(p.blocks);
  const { blocks: valid, issues } = validateBlocks(blocks);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    blocks,
    seo: readPageSeo(p.seo),
    issues,
    // The draft differs from what visitors see.
    hasUnpublishedChanges: p.status === "published" && JSON.stringify(p.publishedBlocks ?? null) !== JSON.stringify(valid),
  };
}

// GET/PATCH/DELETE /api/site/pages/<id>: one page's draft.
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const page = await getPageOrThrow(user.businessId, (await params).id);
    const versions = await db.landingPageVersion.count({ where: { pageId: page.id } });
    return { page: { ...view(page), versions } };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const page = await savePage({ businessId: user.businessId, userId: user.userId, name: user.name }, (await params).id, {
      title: typeof body?.title === "string" ? body.title : undefined,
      slug: typeof body?.slug === "string" ? body.slug : undefined,
      blocks: body && "blocks" in body ? body.blocks : undefined,
      seo: body && "seo" in body ? body.seo : undefined,
    });
    return { page: view(page) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    await deletePage({ businessId: user.businessId, userId: user.userId, name: user.name }, (await params).id);
    return { ok: true };
  });
}
