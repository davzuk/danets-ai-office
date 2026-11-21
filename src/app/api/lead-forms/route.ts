import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { listLeadForms } from "@/lib/social/lead-forms";

// GET /api/lead-forms: Meta and LinkedIn lead forms on this tenant's Pages, plus the Pages themselves
export function GET() {
  return withSession(async (user) => {
    const [forms, pages] = await Promise.all([
      listLeadForms(user.businessId),
      db.socialAccount.findMany({
        where: { businessId: user.businessId, platform: { in: ["facebook_page", "linkedin_page"] } },
        select: { id: true, name: true, platform: true, status: true, leadSyncEnabled: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return { forms, pages, canManage: user.role === "admin" };
  });
}
