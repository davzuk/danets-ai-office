import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { localData } from "@/lib/seo/gbp-metrics";

// GET /api/seo/local?days=28: Business Profile views, calls, website clicks,
// directions and messages (shown on SEO -> Performance).
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const days = Number(new URL(req.url).searchParams.get("days"));
    const rangeDays = [7, 28, 90].includes(days) ? days : 28;
    return localData(user.businessId, { rangeDays });
  });
}
