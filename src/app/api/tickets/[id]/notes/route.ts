import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const noteSchema = z.object({
  content: z.string().min(1).max(5000),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/tickets/[id]/notes — list internal notes
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const ticket = await db.supportTicket.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!ticket) throw new Error("FORBIDDEN");

    const notes = await db.supportTicketNote.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: "desc" },
    });

    return {
      notes: notes.map((n) => ({
        id: n.id,
        authorName: n.authorName,
        content: n.content,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });
}

// POST /api/tickets/[id]/notes — add an internal note
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const ticket = await db.supportTicket.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!ticket) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const note = await db.supportTicketNote.create({
      data: {
        ticketId: id,
        businessId: user.businessId,
        authorId: user.userId,
        authorName: user.name,
        content: parsed.data.content.trim(),
      },
    });

    return {
      note: {
        id: note.id,
        authorName: note.authorName,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
      },
    };
  });
}
