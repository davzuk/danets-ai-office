import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { queueLeadSync } from "@/lib/social/lead-forms";

// POST /api/lead-forms/sync: refresh forms and fetch missed leads now (admins only)
export function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const pages = await db.socialAccount.findMany({
      where: { businessId: user.businessId, platform: { in: ["facebook_page", "linkedin_page"] }, status: "active", leadSyncEnabled: true },
      select: { id: true, businessId: true, platform: true },
    });
    for (const p of pages) await queueLeadSync(p);
    return { queued: pages.length };
  });
}
