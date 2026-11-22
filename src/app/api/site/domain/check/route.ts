import { withSession } from "@/lib/api";
import { checkDomainNow, domainView } from "@/lib/sites/domains";

// POST /api/site/domain/check: look up the DNS records now instead of waiting for the job.
export async function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const site = await checkDomainNow({ businessId: user.businessId, userId: user.userId, name: user.name });
    return { domain: domainView(site) };
  });
}
