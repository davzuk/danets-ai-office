import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCmsAdmin } from "@/lib/cms/server";

const createSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(0).max(50_000_000),
  url: z.string().min(1).max(500),
  altText: z.string().max(500).nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  storageKey: z.string().max(500).nullable().optional(),
});

export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const media = await db.cmsMedia.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ media });
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
  const m = await db.cmsMedia.create({
    data: {
      ...parsed.data,
      uploadedBy: auth.actor.userId,
    },
  });
  return NextResponse.json({ media: m });
}
