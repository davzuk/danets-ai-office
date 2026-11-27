import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { reviewSettingsSchema, saveReviewSettings } from "@/lib/seo/reviews";

// PATCH /api/seo/reviews/settings {autoReplyNoText}: thank 4-5 star reviews
// without text automatically (off by default).
export async function PATCH(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = reviewSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Invalid settings", { status: 400, code: "INVALID_REQUEST" });
    return { settings: await saveReviewSettings({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, parsed.data) };
  });
}
