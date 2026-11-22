import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { restoreVersion } from "@/lib/sites/service";

// POST /api/site/pages/<id>/versions/<versionId>/restore: put that version live again.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id, versionId } = await params;
    const page = await restoreVersion({ businessId: user.businessId, userId: user.userId, name: user.name }, id, versionId);
    return { page: { id: page.id, status: page.status, publishedAt: page.publishedAt } };
  });
}
