import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity, createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";
import { requireQuota } from "@/lib/plan-quota";

const VALID_STATUSES = ["open", "pending", "in_progress", "resolved", "closed"];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

// GET /api/tickets — list tickets for the business
// Supports ?status=, ?priority=, ?q= (search subject/customer)
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const priority = searchParams.get("priority") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;

    const where: any = { businessId: user.businessId };
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (priority && VALID_PRIORITIES.includes(priority)) where.priority = priority;
    if (q) {
      where.OR = [
        { subject: { contains: q } },
        { customerName: { contains: q } },
        { customerEmail: { contains: q } },
      ];
    }

    const tickets = await db.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        category: { select: { id: true, name: true, color: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } },
      },
    });

    return {
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        description: t.description,
        status: t.status,
        priority: t.priority,
        customerName: t.customerName,
        customerEmail: t.customerEmail,
        customerPhone: t.customerPhone,
        assignedName: t.assignedName,
        category: t.category ? { id: t.category.id, name: t.category.name, color: t.category.color } : null,
        aiPriority: t.aiPriority,
        aiSentiment: t.aiSentiment,
        lastMessage: t.messages[0]?.content?.slice(0, 100) || "",
        lastMessageAt: t.messages[0]?.createdAt?.toISOString() || null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        resolvedAt: t.resolvedAt?.toISOString() || null,
      })),
    };
  });
}

const createSchema = z.object({
  subject: z.string().min(2).max(200),
  description: z.string().min(1).max(10000),
  categoryId: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  customerName: z.string().max(100).optional().or(z.literal("")),
  customerEmail: z.string().email().optional().or(z.literal("")),
  customerPhone: z.string().max(40).optional().or(z.literal("")),
});

// POST /api/tickets — create a new ticket manually
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const d = parsed.data;
    await requireQuota(user.businessId, "tickets");

    const ticket = await db.supportTicket.create({
      data: {
        businessId: user.businessId,
        subject: d.subject.trim(),
        description: d.description.trim(),
        priority: d.priority,
        categoryId: d.categoryId || null,
        customerName: d.customerName?.trim() || null,
        customerEmail: d.customerEmail?.trim() || null,
        customerPhone: d.customerPhone?.trim() || null,
        assignedTo: user.userId,
        assignedName: user.name,
      },
      include: {
        category: { select: { id: true, name: true, color: true } },
      },
    });

    // Create initial customer message from the description
    await db.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        role: "customer",
        content: d.description.trim(),
        authorName: d.customerName?.trim() || "Customer",
      },
    });

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "ticket_updated",
      module: "tickets",
      description: `Created ticket "${d.subject.trim()}" (${d.priority} priority)`,
      metadata: { ticketId: ticket.id },
    });

    const notifType = d.priority === "urgent" ? "urgent_ticket" : "new_ticket";
    await createNotification({
      businessId: user.businessId,
      type: notifType,
      title: notifType === "urgent_ticket" ? "Urgent ticket created" : "New support ticket",
      message: `"${d.subject.trim()}" — ${d.priority} priority${d.customerName ? ` from ${d.customerName}` : ""}`,
      data: { ticketId: ticket.id },
    });

    // Fire automation trigger
    await fireTrigger("new_ticket", {
      businessId: user.businessId,
      ticketId: ticket.id,
      ticketSubject: ticket.subject,
    });

    return { ticket };
  });
}
