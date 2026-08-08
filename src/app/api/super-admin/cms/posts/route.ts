import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms, slugSchema, seoSchema } from "@/lib/cms/server";

const createSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  excerpt: z.string().max(500).optional(),
  coverImage: z.string().url().optional(),
  bodyMdx: z.string().default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  authorId: z.string().optional(),
  tagIds: z.array(z.string()).default([]),
  seo: seoSchema,
});

export async function GET(req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  const posts = await db.cmsPost.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      tags: { select: { id: true, slug: true, name: true } },
    },
  });

  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { slug, title, excerpt, coverImage, bodyMdx, status, authorId, tagIds, seo } = parsed.data;

  const existing = await db.cmsPost.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json(
      { error: "A post with this slug already exists" },
      { status: 409 }
    );
  }

  const post = await db.cmsPost.create({
    data: {
      slug,
      title,
      excerpt: excerpt ?? null,
      coverImage: coverImage ?? null,
      bodyMdx,
      status,
      publishedAt: status === "published" ? new Date() : null,
      authorId: authorId ?? null,
      tags: { connect: tagIds.map((id) => ({ id })) },
      seo: seo === null ? Prisma.JsonNull : (seo ?? undefined),
    },
  });

  revalidateCms({ postSlugs: [slug] });
  return NextResponse.json({ post });
}
