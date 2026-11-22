import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { InsightSkipped, generateInsight } from "@/lib/social/insights";

// POST /api/social-analytics/insights: write a fresh insight now (admins; uses one AI credit)
export function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    try {
      return { insight: await generateInsight(user.businessId, { notify: false }) };
    } catch (e) {
      if (e instanceof InsightSkipped) throw new AppError(e.message, { status: 429, code: "QUOTA_EXCEEDED" });
      throw e;
    }
  });
}
