import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms } from "@/lib/cms/server";

const createSchema = z.object({
  version: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  kind: z.enum(["release", "improvement", "fix", "security"]).default("release"),
  publishedAt: z.string().datetime().optional(),
});

export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const entries = await db.cmsChangelogEntry.findMany({
    orderBy: { publishedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ entries });
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
  const { publishedAt, ...rest } = parsed.data;
  const entry = await db.cmsChangelogEntry.create({
    data: {
      ...rest,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
    },
  });
  revalidateCms();
  return NextResponse.json({ entry });
}
