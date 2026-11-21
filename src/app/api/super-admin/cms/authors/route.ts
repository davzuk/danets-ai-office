import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCmsAdmin } from "@/lib/cms/server";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  bio: z.string().max(1000).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  twitter: z.string().max(64).nullable().optional(),
  linkedin: z.string().max(255).nullable().optional(),
});

export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const authors = await db.cmsAuthor.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ authors });
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
  const author = await db.cmsAuthor.create({ data: parsed.data });
  return NextResponse.json({ author });
}
