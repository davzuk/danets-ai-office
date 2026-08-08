import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCmsAdmin, revalidateCms } from "@/lib/cms/server";

const itemSchema = z.object({
  id: z.string().optional(), // for upsert
  parentId: z.string().nullable().optional(),
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(255),
  order: z.number().int().default(0),
  visible: z.boolean().default(true),
  icon: z.string().max(64).nullable().optional(),
});

// Full replace — simpler than incremental sync for an admin console.
export async function GET(_req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const items = await db.cmsNavItem.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = z.object({ items: z.array(itemSchema).max(80) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Wipe + recreate. Cheaper than threading diffs for a small admin tree
  // and ensures stale items from previous edits are cleaned up.
  await db.$transaction(async (tx) => {
    await tx.cmsNavItem.deleteMany({});
    // Two passes: insert top-level first, then children. We need ids
    // for parent linkage.
    const idMap = new Map<string, string>();
    const top = parsed.data.items.filter((i) => !i.parentId);
    for (const item of top) {
      const created = await tx.cmsNavItem.create({
        data: {
          label: item.label,
          href: item.href,
          order: item.order,
          visible: item.visible,
          icon: item.icon ?? null,
        },
      });
      if (item.id) idMap.set(item.id, created.id);
    }
    const children = parsed.data.items.filter((i) => i.parentId);
    for (const item of children) {
      const parentId = item.parentId ? idMap.get(item.parentId) : null;
      if (!parentId) continue;
      const created = await tx.cmsNavItem.create({
        data: {
          label: item.label,
          href: item.href,
          order: item.order,
          visible: item.visible,
          icon: item.icon ?? null,
          parentId,
        },
      });
      if (item.id) idMap.set(item.id, created.id);
    }
  });

  revalidateCms({ navChanged: true });
  return NextResponse.json({ ok: true });
}
