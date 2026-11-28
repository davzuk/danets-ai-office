import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { createCampaignSchema } from "@/lib/campaigns/rules";
import { createCampaign, listCampaigns } from "@/lib/campaigns/service";
import { checkQuota } from "@/lib/plan-quota";

const actor = (u: { businessId: string; userId: string; name: string; role: string }) => ({ businessId: u.businessId, userId: u.userId, name: u.name, role: u.role });

// GET /api/campaigns?archived=1: campaigns with touch, lead and asset counts.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    // In order: listing may first turn old post tags into campaigns, which count toward the limit.
    const campaigns = await listCampaigns(user.businessId, { includeArchived });
    const quota = await checkQuota(user.businessId, "campaigns", 0);
    return { campaigns, limit: { used: quota.used, limit: quota.limit }, canDelete: user.role === "admin" };
  });
}

// POST /api/campaigns: create a campaign.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const parsed = createCampaignSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return { campaign: await createCampaign(actor(user), parsed.data) };
  });
}
