import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";

const LEAD_STATUSES = [
  "new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost",
] as const;

const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
  dealValue: z.number().min(0).optional(),
  leadScore: z.number().min(0).max(100).optional(),
  expectedCloseDate: z.string().datetime().optional().or(z.literal("")).nullable().optional(),
  assignedTo: z.string().optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  service: z.string().max(200).optional().nullable(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/leads/[id] — single lead with linked chat session + CRM data (notes, tasks, activities).
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findUnique({
      where: { id },
      include: {
        session: {
          select: {
            id: true,
            visitorEmail: true,
            visitorName: true,
            visitorPhone: true,
            status: true,
            summary: true,
            nextAction: true,
            leadQuality: true,
          },
        },
        notes: { orderBy: { createdAt: "desc" }, take: 50 },
        tasks: { orderBy: { createdAt: "desc" }, take: 50 },
        activities: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });

    if (!lead) throw new Error("Lead not found");
    // Strict business ownership check — never trust client-supplied id alone.
    if (lead.businessId !== user.businessId) throw new Error("FORBIDDEN");

    return {
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        service: lead.service,
        message: lead.message,
        quality: lead.quality,
        status: lead.status,
        source: lead.source,
        sessionId: lead.sessionId,
        // CRM fields
        dealValue: lead.dealValue,
        leadScore: lead.leadScore,
        expectedCloseDate: lead.expectedCloseDate?.toISOString() || null,
        assignedTo: lead.assignedTo,
        company: lead.company,
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        session: lead.session
          ? {
              id: lead.session.id,
              visitorEmail: lead.session.visitorEmail,
              visitorName: lead.session.visitorName,
              visitorPhone: lead.session.visitorPhone,
              status: lead.session.status,
              summary: lead.session.summary,
              nextAction: lead.session.nextAction,
              leadQuality: lead.session.leadQuality,
            }
          : null,
        notes: lead.notes.map((n) => ({
          id: n.id,
          authorName: n.authorName,
          content: n.content,
          createdAt: n.createdAt.toISOString(),
        })),
        tasks: lead.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          dueDate: t.dueDate?.toISOString() || null,
          completed: t.completed,
          completedAt: t.completedAt?.toISOString() || null,
          createdAt: t.createdAt.toISOString(),
        })),
        activities: lead.activities.map((a) => ({
          id: a.id,
          type: a.type,
          description: a.description,
          actorName: a.actorName,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    };
  });
}

// PATCH /api/leads/[id] — update lead fields (status, quality, CRM fields).
// Logs an activity when status changes.
export function PATCH(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findUnique({
      where: { id },
      select: { id: true, businessId: true, status: true, name: true },
    });

    if (!lead) throw new Error("Lead not found");
    if (lead.businessId !== user.businessId) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const data: any = {};
    const activities: { type: string; description: string }[] = [];

    if (parsed.data.status && parsed.data.status !== lead.status) {
      data.status = parsed.data.status;
      activities.push({
        type: "status_change",
        description: `Status changed from "${lead.status}" to "${parsed.data.status}"`,
      });
    }
    if (parsed.data.quality) data.quality = parsed.data.quality;
    if (parsed.data.dealValue !== undefined) data.dealValue = parsed.data.dealValue;
    if (parsed.data.leadScore !== undefined) data.leadScore = parsed.data.leadScore;
    if (parsed.data.expectedCloseDate !== undefined) {
      data.expectedCloseDate = parsed.data.expectedCloseDate
        ? new Date(parsed.data.expectedCloseDate)
        : null;
    }
    if (parsed.data.assignedTo !== undefined) data.assignedTo = parsed.data.assignedTo || null;
    if (parsed.data.company !== undefined) data.company = parsed.data.company || null;
    if (parsed.data.service !== undefined) data.service = parsed.data.service || null;

    if (Object.keys(data).length === 0) {
      throw new Error("Nothing to update");
    }

    const updated = await db.lead.update({
      where: { id },
      data,
    });

    // Log activities
    if (activities.length > 0) {
      await db.leadActivity.createMany({
        data: activities.map((a) => ({
          leadId: lead.id,
          businessId: user.businessId,
          type: a.type,
          description: a.description,
          actorId: user.userId,
          actorName: user.name,
        })),
      });

      // Also log to central audit log
      await logActivity({
        businessId: user.businessId,
        userId: user.userId,
        userName: user.name,
        action: "lead_status_changed",
        module: "leads",
        description: `Lead "${lead.name}": ${activities[0].description}`,
        metadata: { leadId: lead.id },
      });

      // Fire automation trigger for lead status change
      await fireTrigger("lead_status_changed", {
        businessId: user.businessId,
        leadId: lead.id,
        leadName: lead.name,
      });
    }

    return {
      lead: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        service: updated.service,
        message: updated.message,
        quality: updated.quality,
        status: updated.status,
        source: updated.source,
        sessionId: updated.sessionId,
        dealValue: updated.dealValue,
        leadScore: updated.leadScore,
        expectedCloseDate: updated.expectedCloseDate?.toISOString() || null,
        assignedTo: updated.assignedTo,
        company: updated.company,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    };
  });
}

// DELETE /api/leads/[id] — permanently remove a lead (ownership verified).
export function DELETE(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findUnique({
      where: { id },
      select: { id: true, businessId: true },
    });

    if (!lead) throw new Error("Lead not found");
    if (lead.businessId !== user.businessId) throw new Error("FORBIDDEN");

    await db.lead.delete({ where: { id: lead.id } });
    return { success: true, id: lead.id };
  });
}
