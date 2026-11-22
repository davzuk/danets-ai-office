import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { ANALYTICS_RANGES, buildAnalyticsReport } from "@/lib/social/analytics";
import { latestInsight } from "@/lib/social/insights";

// GET /api/social-analytics?days=7|28|90: engagement dashboard + the latest AI insight
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const asked = Number(req.nextUrl.searchParams.get("days"));
    const days = (ANALYTICS_RANGES as readonly number[]).includes(asked) ? asked : 28;
    const [report, insight] = await Promise.all([buildAnalyticsReport(user.businessId, days), latestInsight(user.businessId)]);
    return { report, insight, canGenerateInsight: user.role === "admin" };
  });
}
