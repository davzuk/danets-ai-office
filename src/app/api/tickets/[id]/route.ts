import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const VALID_STATUSES = ["open", "pending", "in_progress", "resolved", "closed"];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

const patchSchema = z.object({
  status: z.enum(VALID_STATUSES as [string, ...string[]]).optional(),
  priority: z.enum(VALID_PRIORITIES as [string, ...string[]]).optional(),
  categoryId: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  assignedName: z.string().optional().nullable(),
  subject: z.string().min(2).max(200).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/tickets/[id] — single ticket with messages, notes, category
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, color: true } },
      messages: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!ticket || ticket.businessId !== user.businessId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      customerName: ticket.customerName,
      customerEmail: ticket.customerEmail,
      customerPhone: ticket.customerPhone,
      assignedTo: ticket.assignedTo,
      assignedName: ticket.assignedName,
      categoryId: ticket.categoryId,
      category: ticket.category,
      aiSummary: ticket.aiSummary,
      aiPriority: ticket.aiPriority,
      aiSentiment: ticket.aiSentiment,
      aiNextAction: ticket.aiNextAction,
      aiSuggestedReply: ticket.aiSuggestedReply,
      chatSessionId: ticket.chatSessionId,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() || null,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        authorName: m.authorName,
        createdAt: m.createdAt.toISOString(),
      })),
      notes: ticket.notes.map((n) => ({
        id: n.id,
        authorName: n.authorName,
        content: n.content,
        createdAt: n.createdAt.toISOString(),
      })),
    },
  });
}

// PATCH /api/tickets/[id] — update ticket fields
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticket = await db.supportTicket.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const data: any = {};
  if (parsed.data.status) {
    data.status = parsed.data.status;
    if (parsed.data.status === "resolved" && !ticket.resolvedAt) {
      data.resolvedAt = new Date();
    }
    if (parsed.data.status !== "resolved") {
      data.resolvedAt = null;
    }
  }
  if (parsed.data.priority) data.priority = parsed.data.priority;
  if (parsed.data.categoryId !== undefined) data.categoryId = parsed.data.categoryId || null;
  if (parsed.data.assignedTo !== undefined) {
    data.assignedTo = parsed.data.assignedTo || null;
    data.assignedName = parsed.data.assignedName || null;
  }
  if (parsed.data.subject) data.subject = parsed.data.subject.trim();

  const updated = await db.supportTicket.update({
    where: { id },
    data,
    include: {
      category: { select: { id: true, name: true, color: true } },
    },
  });

  return NextResponse.json({ ticket: updated });
}

// DELETE /api/tickets/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticket = await db.supportTicket.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.supportTicket.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
