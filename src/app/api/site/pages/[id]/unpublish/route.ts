import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { unpublishPage } from "@/lib/sites/service";

// POST /api/site/pages/<id>/unpublish: take the page off the site (the draft stays).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const page = await unpublishPage({ businessId: user.businessId, userId: user.userId, name: user.name }, (await params).id);
    return { page: { id: page.id, status: page.status } };
  });
}
