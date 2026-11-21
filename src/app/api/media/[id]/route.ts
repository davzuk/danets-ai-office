import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { MEDIA_LIMITS, deleteMedia, toPublicMedia } from "@/lib/media";

type Ctx = { params: Promise<{ id: string }> };

async function findOwn(businessId: string, id: string) {
  const row = await db.mediaAsset.findFirst({ where: { id, businessId } });
  if (!row) throw new AppError("Media not found.", { status: 404, code: "NOT_FOUND" });
  return row;
}

// PATCH /api/media/:id { altText }
export function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const row = await findOwn(user.businessId, id);
    const body = (await req.json().catch(() => ({}))) as { altText?: unknown };
    if (typeof body.altText !== "string") throw new AppError("altText must be a string.", { status: 400, code: "INVALID_BODY" });
    const updated = await db.mediaAsset.update({
      where: { id: row.id },
      data: { altText: body.altText.trim().slice(0, MEDIA_LIMITS.altText) || null },
    });
    return { item: toPublicMedia(updated) };
  });
}

// DELETE /api/media/:id: admins, or the member who uploaded it
export function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const row = await findOwn(user.businessId, id);
    if (user.role !== "admin" && row.createdById !== user.userId) throw new Error("FORBIDDEN");
    await deleteMedia(row);
    return { ok: true };
  });
}
