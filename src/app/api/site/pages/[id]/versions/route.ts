import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { getPageOrThrow } from "@/lib/sites/service";

// GET /api/site/pages/<id>/versions: what was published, newest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const page = await getPageOrThrow(user.businessId, (await params).id);
    const versions = await db.landingPageVersion.findMany({
      where: { pageId: page.id },
      select: { id: true, title: true, publishedBy: true, restoredFrom: true, createdAt: true, blocks: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      versions: versions.map((v, i) => ({
        id: v.id,
        title: v.title,
        publishedBy: v.publishedBy,
        restoredFrom: v.restoredFrom,
        createdAt: v.createdAt,
        blockCount: Array.isArray(v.blocks) ? v.blocks.length : 0,
        live: i === 0 && page.status === "published",
      })),
    };
  });
}
