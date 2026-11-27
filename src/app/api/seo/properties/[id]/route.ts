import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { removeProperty } from "@/lib/seo/setup";

// DELETE /api/seo/properties/<id>: stop using a Search Console property.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    await removeProperty({ businessId: user.businessId, userId: user.userId, name: user.name }, (await params).id);
    return { ok: true };
  });
}
