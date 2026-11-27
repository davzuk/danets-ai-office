import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { performanceData } from "@/lib/seo/search";

// GET /api/seo/performance?range=28&property=<id>: the tenant's search
// clicks, impressions, CTR and position over time, top queries and pages
// (with organic leads per page) and device/country breakdowns. Read from
// SearchMetricDaily, so it never waits on Google.
export async function GET(req: NextRequest) {
  return withSession((user) => {
    const sp = new URL(req.url).searchParams;
    const rangeDays = Number(sp.get("range") ?? 28);
    const propertyId = sp.get("property");
    return performanceData(user.businessId, { rangeDays, propertyId });
  });
}