import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { removeLocation } from "@/lib/seo/setup";

// DELETE /api/seo/locations/<id>: stop managing a Business Profile location.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    await removeLocation({ businessId: user.businessId, userId: user.userId, name: user.name }, (await params).id);
    return { ok: true };
  });
}
