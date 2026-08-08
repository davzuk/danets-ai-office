import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import {
  beforeCursorWhere,
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from "@/lib/cursor-pagination";

// List leads for the current business. Supports ?status=, ?quality=,
// ?q= (search name/email/phone), and cursor-based pagination via
// ?cursor=<base64> / ?take=<n>. Ordered by createdAt desc with id as
// the tiebreaker so the (businessId, createdAt) compound index from
// the P17 migration can satisfy the query without a sort step.
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const quality = searchParams.get("quality") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;
    const cursor = decodeCursor(searchParams.get("cursor"));
    const take = clampPageSize(
      Number(searchParams.get("take") || 0) || undefined
    );

    const validStatuses = ["new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost"];
    const validQualities = ["low", "medium", "high"];

    const where: any = { businessId: user.businessId };
    if (status && validStatuses.includes(status)) where.status = status;
    if (quality && validQualities.includes(quality)) where.quality = quality;
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }
    Object.assign(where, beforeCursorWhere(cursor));

    // Fetch `take + 1` so we can tell whether there's another page without
    // a separate `count()` round-trip.
    const rows = await db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      include: {
        session: {
          select: { id: true, visitorEmail: true },
        },
      },
    });
    const hasMore = rows.length > take;
    const leads = rows.slice(0, take);
    const last = leads[leads.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
      : null;

    return {
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        service: l.service,
        message: l.message,
        quality: l.quality,
        status: l.status,
        source: l.source,
        sessionId: l.sessionId,
        dealValue: l.dealValue,
        leadScore: l.leadScore,
        company: l.company,
        visitorEmail: l.session?.visitorEmail ?? null,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
      nextCursor,
    };
  });
}