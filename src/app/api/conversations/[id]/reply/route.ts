import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { sendSocialReply } from "@/lib/social/inbox-reply";

type RouteCtx = { params: Promise<{ id: string }> };

const schema = z.object({
  text: z.string().trim().min(1).max(2000),
  mode: z.enum(["reply", "private"]).optional(),
  /** Sending an AI draft (possibly edited) removes the draft. */
  draftId: z.string().optional(),
});

// POST /api/conversations/[id]/reply: send a team reply on a social thread
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Write a message first (max 2000 characters)", { status: 400, code: "INVALID_REQUEST" });

    const message = await sendSocialReply({
      sessionId: id,
      businessId: user.businessId,
      text: parsed.data.text,
      userId: user.userId,
      mode: parsed.data.mode,
    });
    if (parsed.data.draftId) {
      await db.chatMessage.deleteMany({ where: { id: parsed.data.draftId, sessionId: id, deliveryStatus: "draft" } });
    }
    return { message };
  });
}
