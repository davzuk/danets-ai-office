import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// AI Usage analytics endpoint.
// Returns totals, per-feature aggregates, 14-day daily series, and last 50 logs.
export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;

    // ── Per-feature aggregates via groupBy ──────────────────────────────
    const featureGroups = await db.aiUsageLog.groupBy({
      by: ["feature"],
      where: { businessId },
      _count: { _all: true },
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
    });

    // Ensure all four known features appear in the result even if zero.
    const knownFeatures = ["chat", "suggested_reply", "quote", "summary"];
    const byFeature = knownFeatures.map((feature) => {
      const g = featureGroups.find((x) => x.feature === feature);
      return {
        feature,
        count: g?._count?._all ?? 0,
        tokens: g?._sum?.totalTokens ?? 0,
        costUsd: Number(g?._sum?.costUsd ?? 0),
      };
    });
    // Append any unexpected features (defensive) so we don't lose data.
    for (const g of featureGroups) {
      if (!knownFeatures.includes(g.feature)) {
        byFeature.push({
          feature: g.feature,
          count: g._count?._all ?? 0,
          tokens: g._sum?.totalTokens ?? 0,
          costUsd: Number(g._sum?.costUsd ?? 0),
        });
      }
    }

    // ── Totals ──────────────────────────────────────────────────────────
    const totalsAgg = await db.aiUsageLog.aggregate({
      where: { businessId },
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
    });
    const errorAgg = await db.aiUsageLog.aggregate({
      where: { businessId, status: "error" },
      _count: { _all: true },
    });

    const totalRequests = totalsAgg._count._all;
    const totalTokens = totalsAgg._sum?.totalTokens ?? 0;
    const totalCostUsd = Number(totalsAgg._sum?.costUsd ?? 0);
    const errorCount = errorAgg._count._all;

    // ── 14-day daily series (aggregate in JS) ───────────────────────────
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 13); // today + 13 = 14 days inclusive

    const recentLogs = await db.aiUsageLog.findMany({
      where: { businessId, createdAt: { gte: since } },
      select: { totalTokens: true, createdAt: true },
    });

    const dayMap = new Map<string, { count: number; tokens: number }>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      dayMap.set(dateKey(d), { count: 0, tokens: 0 });
    }
    for (const log of recentLogs) {
      const key = dateKey(log.createdAt);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.tokens += log.totalTokens;
      }
    }
    const byDay = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      count: v.count,
      tokens: v.tokens,
    }));

    // ── Recent activity (last 50) ───────────────────────────────────────
    const recent = await db.aiUsageLog.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        feature: true,
        totalTokens: true,
        costUsd: true,
        status: true,
        error: true,
        createdAt: true,
      },
    });

    return {
      totals: {
        totalRequests,
        totalTokens,
        totalCostUsd,
        errorCount,
      },
      byFeature,
      byDay,
      recent: recent.map((r) => ({
        id: r.id,
        feature: r.feature,
        totalTokens: r.totalTokens,
        costUsd: Number(r.costUsd),
        status: r.status,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
