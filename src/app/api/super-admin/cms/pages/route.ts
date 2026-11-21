import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms, slugSchema, blocksArraySchema, seoSchema } from "@/lib/cms/server";

const createSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(320).optional(),
  ogImage: z.string().url().optional(),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  blocks: blocksArraySchema.default([]),
  seo: seoSchema,
});

export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;

  const pages = await db.cmsPage.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ pages });
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

  const { slug, title, description, ogImage, status, blocks, seo } = parsed.data;

  const existing = await db.cmsPage.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json(
      { error: "A page with this slug already exists" },
      { status: 409 }
    );
  }

  const page = await db.cmsPage.create({
    data: {
      slug,
      title,
      description: description ?? null,
      ogImage: ogImage ?? null,
      status,
      publishedAt: status === "published" ? new Date() : null,
      blocks,
      seo: seo === null ? Prisma.JsonNull : (seo ?? undefined),
    },
  });

  revalidateCms({ pageSlugs: [slug] });

  return NextResponse.json({ page });
}
