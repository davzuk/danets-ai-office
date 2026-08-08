import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms } from "@/lib/cms/server";

const upsertSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  schema: z.any(),
  defaultProps: z.record(z.string(), z.any()).default({}),
  icon: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const blocks = await db.cmsBlock.findMany({
    orderBy: { label: "asc" },
  });
  return NextResponse.json({ blocks });
}

export async function POST(req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const block = await db.cmsBlock.upsert({
    where: { key: data.key },
    update: {
      label: data.label,
      description: data.description ?? null,
      schema: data.schema,
      defaultProps: data.defaultProps,
      icon: data.icon ?? null,
      isActive: data.isActive,
    },
    create: {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      schema: data.schema,
      defaultProps: data.defaultProps,
      icon: data.icon ?? null,
      isActive: data.isActive,
    },
  });
  revalidateCms({ blocksChanged: true });
  return NextResponse.json({ block });
}
