import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { requireAiQuota } from "@/lib/plan-limits";
import { createBrief, createBriefSchema, listBriefs } from "@/lib/seo/briefs";

export const maxDuration = 90;

// GET /api/seo/briefs: the tenant's content briefs, newest first.
export async function GET() {
  return withSession(async (user) => ({ briefs: await listBriefs(user.businessId) }));
}

// POST {opportunityId} | {query, propertyId?}: an AI content brief from the
// knowledge base (any role; uses the tenant's AI quota).
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const parsed = createBriefSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Pick an opportunity or enter a search.", { status: 400, code: "INVALID_REQUEST" });
    await requireAiQuota(user.businessId);
    return createBrief({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, parsed.data);
  });
}
