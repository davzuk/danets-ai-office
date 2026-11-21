import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { isCommentChannel, messageWindow } from "@/lib/social/inbox";

// GET /api/conversations/[id]
// Returns a single ChatSession with all messages (asc by createdAt) + lead.
// The session MUST belong to the user's business. We use findFirst with
// { id, businessId } so the WHERE itself enforces tenant isolation — no
// chance of forgetting the post-load check after a future refactor.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;

    const session = await db.chatSession.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        lead: true,
        agent: {
          select: { id: true, botName: true },
        },
        socialAccount: { select: { id: true, name: true, platform: true, autoReply: true, status: true, username: true } },
      },
    });

    if (!session) {
      return { session: null };
    }

    // Social threads: who sent team replies, and whether Meta still lets us reply.
    let social: { window: { state: string; closesAt: string | null } | null; senders: Record<string, string> } | null = null;
    if (session.channel !== "widget") {
      const senderIds = [...new Set(session.messages.map((m) => m.sentByUserId).filter((v): v is string => !!v))];
      const senders = senderIds.length
        ? await db.businessUser.findMany({ where: { id: { in: senderIds }, businessId: user.businessId }, select: { id: true, name: true } })
        : [];
      const win = isCommentChannel(session.channel) ? null : messageWindow(session.lastInboundAt);
      social = {
        window: win ? { state: win.state, closesAt: win.closesAt?.toISOString() ?? null } : null,
        senders: Object.fromEntries(senders.map((u) => [u.id, u.name])),
      };
    }

    return { session, social };
  });
}

const patchSchema = z
  .object({ autoReplyPaused: z.boolean(), status: z.enum(["active", "ended", "handover"]) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

// PATCH /api/conversations/[id] { autoReplyPaused?, status? }: take over from / hand back to the AI
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    const row = await db.chatSession.findFirst({ where: { id, businessId: user.businessId }, select: { id: true } });
    if (!row) throw new AppError("Conversation not found", { status: 404, code: "NOT_FOUND" });

    const data = { ...parsed.data };
    // Handing back to the AI also clears a handover.
    if (data.autoReplyPaused === false && !data.status) data.status = "active";
    const session = await db.chatSession.update({ where: { id }, data });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "conversation_updated",
      module: "conversations",
      description: data.autoReplyPaused === true ? "Took over a conversation from the AI" : data.autoReplyPaused === false ? "Handed a conversation back to the AI" : `Conversation marked ${data.status}`,
      metadata: { sessionId: id, ...data },
    });
    return { session: { id: session.id, status: session.status, autoReplyPaused: session.autoReplyPaused } };
  });
}
