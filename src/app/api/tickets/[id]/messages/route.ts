import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const messageSchema = z.object({
  role: z.enum(["customer", "agent"]),
  content: z.string().min(1).max(10000),
  authorName: z.string().max(100).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/tickets/[id]/messages — list messages
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const ticket = await db.supportTicket.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!ticket) throw new Error("FORBIDDEN");

    const messages = await db.supportTicketMessage.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: "asc" },
    });

    return {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        authorName: m.authorName,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}

// POST /api/tickets/[id]/messages — add a message (customer or agent reply)
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const ticket = await db.supportTicket.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true, status: true },
    });
    if (!ticket) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const message = await db.supportTicketMessage.create({
      data: {
        ticketId: id,
        role: parsed.data.role,
        content: parsed.data.content.trim(),
        authorId: parsed.data.role === "agent" ? user.userId : null,
        authorName: parsed.data.role === "agent" ? user.name : (parsed.data.authorName || "Customer"),
      },
    });

    // If agent replies, update ticket status to "pending" (awaiting customer)
    if (parsed.data.role === "agent" && ticket.status === "open") {
      await db.supportTicket.update({
        where: { id },
        data: { status: "pending" },
      });
    }

    return {
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        authorName: message.authorName,
        createdAt: message.createdAt.toISOString(),
      },
    };
  });
}
