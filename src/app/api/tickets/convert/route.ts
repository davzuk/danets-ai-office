import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const convertSchema = z.object({
  chatSessionId: z.string().min(1),
  subject: z.string().min(2).max(200).optional(),
  categoryId: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

// POST /api/tickets/convert — convert a chat session into a support ticket
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = convertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { chatSessionId, subject, categoryId, priority } = parsed.data;

  // Verify chat session belongs to business
  const session = await db.chatSession.findFirst({
    where: { id: chatSessionId, businessId: user.businessId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
  }

  // Check if a ticket already exists for this session
  const existing = await db.supportTicket.findFirst({
    where: { chatSessionId, businessId: user.businessId },
  });
  if (existing) {
    return NextResponse.json({ error: "A ticket already exists for this chat session", ticketId: existing.id }, { status: 409 });
  }

  // Build subject and description from chat
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  const ticketSubject = subject || firstUserMsg?.content.slice(0, 100) || `Chat from ${session.visitorName || "visitor"}`;
  const description = firstUserMsg?.content || "Converted from chat session";

  const ticket = await db.supportTicket.create({
    data: {
      businessId: user.businessId,
      chatSessionId,
      subject: ticketSubject,
      description,
      priority,
      categoryId: categoryId || null,
      customerName: session.visitorName,
      customerEmail: session.visitorEmail,
      customerPhone: session.visitorPhone,
      assignedTo: user.userId,
      assignedName: user.name,
    },
  });

  // Copy chat messages as ticket messages
  if (session.messages.length > 0) {
    await db.supportTicketMessage.createMany({
      data: session.messages.map((m) => ({
        ticketId: ticket.id,
        role: m.role === "user" ? "customer" : m.role === "assistant" ? "agent" : "system",
        content: m.content,
        authorName: m.role === "user" ? (session.visitorName || "Customer") : "AI Assistant",
      })),
    });
  }

  return NextResponse.json({ ticket });
}
