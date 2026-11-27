import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { requireAiQuota } from "@/lib/plan-limits";
import { suggestFix } from "@/lib/seo/audit";

export const maxDuration = 60;

// POST /api/seo/audit/issues/:id/suggest: AI-written fix (title, meta
// description, H1 or alt text) for one issue, in the brand voice. A
// suggestion to copy: Danets never edits the site.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    await requireAiQuota(user.businessId);
    return { issue: await suggestFix({ businessId: user.businessId, userId: user.userId, name: user.name }, id) };
  });
}
