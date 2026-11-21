import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms, slugSchema, blocksArraySchema, seoSchema } from "@/lib/cms/server";

const updateSchema = z.object({
  slug: slugSchema.optional(),
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(320).nullable().optional(),
  ogImage: z.string().url().nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  blocks: blocksArraySchema.optional(),
  seo: seoSchema,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;
  const page = await db.cmsPage.findUnique({ where: { id } });
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ page });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await db.cmsPage.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Slug uniqueness check when changing
  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const conflict = await db.cmsPage.findUnique({
      where: { slug: parsed.data.slug },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Another page already uses this slug" },
        { status: 409 }
      );
    }
  }

  // Manage publishedAt when status transitions
  const nextStatus = parsed.data.status ?? existing.status;
  const publishedAt =
    nextStatus === "published"
      ? existing.publishedAt ?? new Date()
      : parsed.data.status === "draft"
      ? null
      : existing.publishedAt;

  const updated = await db.cmsPage.update({
    where: { id },
    data: {
      slug: parsed.data.slug ?? undefined,
      title: parsed.data.title ?? undefined,
      description:
        parsed.data.description === undefined
          ? undefined
          : parsed.data.description,
      ogImage: parsed.data.ogImage === undefined ? undefined : parsed.data.ogImage,
      status: nextStatus,
      publishedAt,
      blocks: parsed.data.blocks ?? undefined,
      seo:
        parsed.data.seo === undefined
          ? undefined
          : parsed.data.seo === null
          ? Prisma.JsonNull
          : parsed.data.seo,
    },
  });

  // Revalidate both the old and new slugs when renaming
  const slugsToRevalidate = [existing.slug];
  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    slugsToRevalidate.push(parsed.data.slug);
  }
  revalidateCms({ pageSlugs: slugsToRevalidate });

  return NextResponse.json({ page: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;

  const existing = await db.cmsPage.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.cmsPage.delete({ where: { id } });
  revalidateCms({ pageSlugs: [existing.slug] });
  return NextResponse.json({ ok: true });
}
