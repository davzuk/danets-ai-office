import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms } from "@/lib/cms/server";

const updateSchema = z.object({
  brandName: z.string().min(1).max(120).optional(),
  tagline: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  supportEmail: z.string().email().max(191).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  faviconUrl: z.string().url().max(500).nullable().optional(),
  primaryColor: z.string().max(20).optional(),
  accentColor: z.string().max(20).optional(),
  socialLinks: z.record(z.string(), z.string()).nullable().optional(),
  seoDefaults: z
    .object({
      title: z.string().max(160).optional(),
      description: z.string().max(320).optional(),
      ogImage: z.string().url().optional(),
    })
    .partial()
    .nullable()
    .optional(),
});

export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const site = await db.cmsSite.findFirst({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ site });
}

export async function PUT(req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await db.cmsSite.findFirst({ orderBy: { createdAt: "asc" } });
  const data = parsed.data;

  // Prisma's Json column requires Prisma.JsonNull for explicit null and
  // rejects raw JS null for nullable JSON inputs.
  const jsonData = {
    socialLinks:
      data.socialLinks === undefined
        ? undefined
        : data.socialLinks === null
        ? Prisma.JsonNull
        : data.socialLinks,
    seoDefaults:
      data.seoDefaults === undefined
        ? undefined
        : data.seoDefaults === null
        ? Prisma.JsonNull
        : data.seoDefaults,
  };

  const site = existing
    ? await db.cmsSite.update({
        where: { id: existing.id },
        data: {
          brandName: data.brandName,
          tagline: data.tagline,
          description: data.description,
          supportEmail: data.supportEmail,
          logoUrl: data.logoUrl,
          faviconUrl: data.faviconUrl,
          primaryColor: data.primaryColor,
          accentColor: data.accentColor,
          socialLinks: jsonData.socialLinks,
          seoDefaults: jsonData.seoDefaults,
        },
      })
    : await db.cmsSite.create({
        data: {
          brandName: data.brandName ?? "Danets AI Automation",
          tagline: data.tagline,
          description: data.description,
          supportEmail: data.supportEmail,
          logoUrl: data.logoUrl,
          faviconUrl: data.faviconUrl,
          primaryColor: data.primaryColor,
          accentColor: data.accentColor,
          socialLinks: jsonData.socialLinks,
          seoDefaults: jsonData.seoDefaults,
        },
      });

  revalidateCms({ siteChanged: true });
  return NextResponse.json({ site });
}
