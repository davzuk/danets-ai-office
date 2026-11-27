import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { checkBusiness, setupData } from "@/lib/seo/setup";

const MIN_GAP_MS = 30_000;

// POST /api/seo/check: check now that Google still lets us read each
// property and location (the daily seo.health job does the same).
export async function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const since = new Date(Date.now() - MIN_GAP_MS);
    const recent = await Promise.all([
      db.searchProperty.count({ where: { businessId: user.businessId, lastCheckedAt: { gte: since } } }),
      db.businessLocation.count({ where: { businessId: user.businessId, lastCheckedAt: { gte: since } } }),
    ]);
    if (recent[0] + recent[1] > 0) throw new AppError("Checked a moment ago. Try again in half a minute.", { status: 429, code: "TOO_SOON" });
    await checkBusiness(user.businessId);
    return setupData(user.businessId);
  });
}
