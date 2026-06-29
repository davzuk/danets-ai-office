import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// Lead analytics for the current business.
// Returns totals, per-quality & per-status breakdowns, this-week count,
// and conversion rate (won / total).
export function GET() {
  return withSession(async (user) => {
  const businessId = user.businessId;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    total,
    newCount,
    highCount,
    wonCount,
    qualityGroups,
    statusGroups,
    weekCount,
    dealValueAgg,
  ] = await Promise.all([
    db.lead.count({ where: { businessId } }),
    db.lead.count({ where: { businessId, status: "new" } }),
    db.lead.count({ where: { businessId, quality: "high" } }),
    db.lead.count({ where: { businessId, status: "won" } }),
    db.lead.groupBy({
      by: ["quality"],
      where: { businessId },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ["status"],
      where: { businessId },
      _count: { _all: true },
    }),
    db.lead.count({
      where: { businessId, createdAt: { gte: sevenDaysAgo } },
    }),
    db.lead.aggregate({
      where: { businessId, status: { in: ["qualified", "proposal_sent", "negotiation", "won"] } },
      _sum: { dealValue: true },
    }),
  ]);

  const knownQualities = ["low", "medium", "high"];
  const knownStatuses = ["new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost"];

  const byQuality = knownQualities.map((quality) => {
    const g = qualityGroups.find((x) => x.quality === quality);
    return { quality, count: g?._count?._all ?? 0 };
  });
  // Append any unexpected qualities defensively.
  for (const g of qualityGroups) {
    if (!knownQualities.includes(g.quality)) {
      byQuality.push({ quality: g.quality, count: g._count?._all ?? 0 });
    }
  }

  const byStatus = knownStatuses.map((status) => {
    const g = statusGroups.find((x) => x.status === status);
    return { status, count: g?._count?._all ?? 0 };
  });
  for (const g of statusGroups) {
    if (!knownStatuses.includes(g.status)) {
      byStatus.push({ status: g.status, count: g._count?._all ?? 0 });
    }
  }

  return {
    total,
    new: newCount,
    high: highCount,
    won: wonCount,
    conversionRate: total > 0 ? Math.round((wonCount / total) * 100) : 0,
    pipelineValue: dealValueAgg._sum.dealValue || 0,
    byQuality,
    byStatus,
    thisWeek: weekCount,
  };
  });
}
