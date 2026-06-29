import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const patchSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/leads/[id] — single lead with linked chat session.
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
      },
    };
  });
}

// PATCH /api/leads/[id] — update status and/or quality.
export function PATCH(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findUnique({
      where: { id },
      select: { id: true, businessId: true },
    });

    if (!lead) throw new Error("Lead not found");
    if (lead.businessId !== user.businessId) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new Error("Invalid input");
    if (!parsed.data.status && !parsed.data.quality) {
      throw new Error("Nothing to update");
    }

    const updated = await db.lead.update({
      where: { id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.quality ? { quality: parsed.data.quality } : {}),
      },
    });

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
