import { withSession } from "@/lib/api";
import { campaignOptions } from "@/lib/campaigns/service";

// GET /api/campaigns/options: open campaigns for the pickers in other builders.
export async function GET() {
  return withSession(async (user) => ({ campaigns: await campaignOptions(user.businessId) }));
}
