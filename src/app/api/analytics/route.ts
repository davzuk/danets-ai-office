import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { computeDashboardInsights } from "@/lib/dashboard-insights";

// GET /api/analytics — conversation & AI insights (starter+ module)
export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    return computeDashboardInsights(user.businessId);
  });
}
