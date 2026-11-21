import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/leads/[id]/journey: the lead's marketing touchpoints (oldest first)
// across every visit, chat and form from the same contact.
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true, contactId: true, firstTouchId: true, lastTouchId: true },
    });
    if (!lead) throw new Error("FORBIDDEN");

    const touchIds = [lead.firstTouchId, lead.lastTouchId].filter((x): x is string => !!x);
    const where = lead.contactId
      ? { businessId: user.businessId, contactId: lead.contactId }
      : touchIds.length
        ? { businessId: user.businessId, id: { in: touchIds } }
        : null;

    const [touchpoints, contact] = await Promise.all([
      where ? db.touchpoint.findMany({ where, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 200 }) : [],
      lead.contactId
        ? db.contact.findFirst({
            where: { id: lead.contactId, businessId: user.businessId },
            select: {
              id: true,
              firstSeenAt: true,
              lastSeenAt: true,
              _count: { select: { leads: true, chatSessions: true, supportTickets: true, quoteRequests: true } },
            },
          })
        : null,
    ]);

    return {
      firstTouchId: lead.firstTouchId,
      lastTouchId: lead.lastTouchId,
      contact: contact && {
        id: contact.id,
        firstSeenAt: contact.firstSeenAt.toISOString(),
        lastSeenAt: contact.lastSeenAt.toISOString(),
        counts: contact._count,
      },
      touchpoints: touchpoints.map((t) => ({
        id: t.id,
        kind: t.kind,
        channel: t.channel,
        source: t.source,
        medium: t.medium,
        campaign: t.campaign,
        term: t.term,
        content: t.content,
        clickIdType: t.clickIdType,
        landingUrl: t.landingUrl,
        referrer: t.referrer,
        occurredAt: t.occurredAt.toISOString(),
      })),
    };
  });
}
