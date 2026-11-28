import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { requireAiQuota } from "@/lib/plan-limits";
import { suggestForOpportunity } from "@/lib/seo/keywords";

export const maxDuration = 60;

// POST: AI-written titles and meta descriptions for a low click-through
// page, in the brand voice (admin). A suggestion to copy: Danets never edits the site.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    await requireAiQuota(user.businessId);
    return { opportunity: await suggestForOpportunity({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id) };
  });
}
