import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { queueLeadSync } from "@/lib/social/lead-forms";

// POST /api/lead-forms/sync: refresh forms and fetch missed leads now (admins only)
export function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const pages = await db.socialAccount.findMany({
      where: { businessId: user.businessId, platform: "facebook_page", status: "active", leadSyncEnabled: true },
      select: { id: true, businessId: true },
    });
    for (const p of pages) await queueLeadSync(p);
    return { queued: pages.length };
  });
}
