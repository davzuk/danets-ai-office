import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { enqueueReviewsSync } from "@/lib/jobs/handlers/gbp-sync";

// POST /api/seo/reviews/sync: fetch new reviews now instead of waiting for
// the 2-hourly sync.
export async function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const locations = await db.businessLocation.findMany({ where: { businessId: user.businessId, status: { not: "lost_access" } }, select: { id: true } });
    if (!locations.length) throw new AppError("Add a Business Profile location in Setup first.", { status: 400, code: "NO_LOCATION" });
    for (const l of locations) await enqueueReviewsSync(l.id, user.businessId);
    return { queued: locations.length };
  });
}
