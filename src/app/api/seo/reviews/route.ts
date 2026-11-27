import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { inboxQuery, reviewsData } from "@/lib/seo/reviews";

// GET /api/seo/reviews?filter=&rating=&locationId=&page=: the Business
// Profile reviews inbox (SEO -> Reviews).
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const parsed = inboxQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) throw new AppError("Invalid filter", { status: 400, code: "INVALID_REQUEST" });
    return { ...(await reviewsData(user.businessId, parsed.data)), canEdit: user.role === "admin" };
  });
}
