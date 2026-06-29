import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// List leads for the current business.
// Supports ?status=, ?quality=, ?q= (search name/email/phone).
// Ordered by createdAt desc, includes related chatSession (id + visitorEmail).
// Capped at 200 rows.
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const quality = searchParams.get("quality") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;

    const validStatuses = ["new", "contacted", "qualified", "won", "lost"];
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

    const leads = await db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        session: {
          select: { id: true, visitorEmail: true },
        },
      },
    });

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
        visitorEmail: l.session?.visitorEmail ?? null,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
    };
  });
}
