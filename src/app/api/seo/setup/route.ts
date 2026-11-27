import { withSession } from "@/lib/api";
import { setupData } from "@/lib/seo/setup";

// GET /api/seo/setup: the tenant's Google connections, Search Console
// properties, Business Profile locations and limits (SEO -> Setup).
export async function GET() {
  return withSession(async (user) => ({ ...(await setupData(user.businessId)), canEdit: user.role === "admin" }));
}
