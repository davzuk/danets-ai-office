import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms, slugSchema, seoSchema } from "@/lib/cms/server";

const updateSchema = z.object({
  slug: slugSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  coverImage: z.string().url().nullable().optional(),
  bodyMdx: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  authorId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
  seo: seoSchema,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;
  const post = await db.cmsPost.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      tags: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
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

  const existing = await db.cmsPost.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const conflict = await db.cmsPost.findUnique({
      where: { slug: parsed.data.slug },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Another post already uses this slug" },
        { status: 409 }
      );
    }
  }

  const nextStatus = parsed.data.status ?? existing.status;
  const publishedAt =
    nextStatus === "published"
      ? existing.publishedAt ?? new Date()
      : parsed.data.status === "draft"
      ? null
      : existing.publishedAt;

  const updated = await db.cmsPost.update({
    where: { id },
    data: {
      slug: parsed.data.slug ?? undefined,
      title: parsed.data.title ?? undefined,
      excerpt: parsed.data.excerpt === undefined ? undefined : parsed.data.excerpt,
      coverImage:
        parsed.data.coverImage === undefined ? undefined : parsed.data.coverImage,
      bodyMdx: parsed.data.bodyMdx ?? undefined,
      status: nextStatus,
      publishedAt,
      authorId: parsed.data.authorId === undefined ? undefined : parsed.data.authorId,
      ...(parsed.data.tagIds
        ? { tags: { set: parsed.data.tagIds.map((id) => ({ id })) } }
        : {}),
      seo:
        parsed.data.seo === undefined
          ? undefined
          : parsed.data.seo === null
          ? Prisma.JsonNull
          : parsed.data.seo,
    },
  });

  const slugs = [existing.slug];
  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    slugs.push(parsed.data.slug);
  }
  revalidateCms({ postSlugs: slugs });
  return NextResponse.json({ post: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { id } = await params;

  const existing = await db.cmsPost.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.cmsPost.delete({ where: { id } });
  revalidateCms({ postSlugs: [existing.slug] });
  return NextResponse.json({ ok: true });
}
