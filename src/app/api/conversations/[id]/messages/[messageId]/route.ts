import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { hideThreadComment } from "@/lib/social/inbox-reply";

type RouteCtx = { params: Promise<{ id: string; messageId: string }> };

// PATCH /api/conversations/[id]/messages/[messageId] { hidden }: hide/unhide a comment on Meta
export function PATCH(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id, messageId } = await params;
    const parsed = z.object({ hidden: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Invalid request", { status: 400, code: "INVALID_REQUEST" });
    const message = await hideThreadComment(id, user.businessId, messageId, parsed.data.hidden);
    return { message };
  });
}

// DELETE /api/conversations/[id]/messages/[messageId]: discard an AI draft
export function DELETE(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id, messageId } = await params;
    const res = await db.chatMessage.deleteMany({
      where: { id: messageId, deliveryStatus: "draft", session: { id, businessId: user.businessId } },
    });
    if (res.count === 0) throw new AppError("Draft not found", { status: 404, code: "NOT_FOUND" });
    return { success: true };
  });
}
