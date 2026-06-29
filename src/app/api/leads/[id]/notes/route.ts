import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const noteSchema = z.object({
  content: z.string().min(1).max(5000),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/leads/[id]/notes — list notes for a lead
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const notes = await db.leadNote.findMany({
      where: { leadId: id },
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

// POST /api/leads/[id]/notes — add a note to a lead
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true, name: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const note = await db.leadNote.create({
      data: {
        leadId: id,
        businessId: user.businessId,
        authorId: user.userId,
        authorName: user.name,
        content: parsed.data.content.trim(),
      },
    });

    // Log activity
    await db.leadActivity.create({
      data: {
        leadId: id,
        businessId: user.businessId,
        type: "note_added",
        description: `Note added by ${user.name}`,
        actorId: user.userId,
        actorName: user.name,
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
