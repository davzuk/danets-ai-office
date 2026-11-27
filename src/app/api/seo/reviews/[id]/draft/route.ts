import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { requireAiQuota } from "@/lib/plan-limits";
import { draftReply } from "@/lib/seo/reviews";

export const maxDuration = 60;

// POST /api/seo/reviews/:id/draft: an AI-written reply in the brand voice,
// saved as a draft to edit before posting.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    await requireAiQuota(user.businessId);
    return draftReply({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id);
  });
}
