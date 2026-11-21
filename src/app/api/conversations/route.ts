import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { REPLY_CHANNELS as CHANNELS } from "@/lib/agent-reply";
import { withSession } from "@/lib/api";
import {
  beforeTimestampCursor,
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from "@/lib/cursor-pagination";

// GET /api/conversations?status=active|ended|handover&channel=widget|social|messenger|…&q=<search>
// Lists ChatSessions for the user's business, with latest message + lead
// included. Ordered by updatedAt desc, cursor-paginated via ?cursor=<base64>
// and ?take=<n>.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const q = url.searchParams.get("q")?.trim() || undefined;
    const channel = url.searchParams.get("channel") || undefined;
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const take = clampPageSize(
      Number(url.searchParams.get("take") || 0) || undefined,
      50,
      100
    );

    if (status && !["active", "ended", "handover"].includes(status)) {
      return { sessions: [], error: "Invalid status filter" };
    }

    const where: any = { businessId: user.businessId };
    if (status) where.status = status;
    if (channel === "social") where.channel = { not: "widget" };
    else if (channel && (CHANNELS as readonly string[]).includes(channel)) where.channel = channel;
    if (q) {
      where.OR = [
        { visitorName: { contains: q } },
        { visitorEmail: { contains: q } },
      ];
    }
    Object.assign(where, beforeTimestampCursor(cursor, "updatedAt"));

    const rows = await db.chatSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: take + 1,
      include: {
        lead: true,
        socialAccount: { select: { id: true, name: true, platform: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.updatedAt.toISOString(), id: last.id })
      : null;

    const sessions = page.map((s) => ({
      id: s.id,
      businessId: s.businessId,
      agentId: s.agentId,
      visitorName: s.visitorName,
      visitorEmail: s.visitorEmail,
      visitorPhone: s.visitorPhone,
      visitorId: s.visitorId,
      status: s.status,
      summary: s.summary,
      leadQuality: s.leadQuality,
      nextAction: s.nextAction,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lead: s.lead,
      channel: s.channel,
      socialAccount: s.socialAccount,
      autoReplyPaused: s.autoReplyPaused,
      latestMessage: s.messages[0] || null,
    }));

    return { sessions, nextCursor };
  });
}