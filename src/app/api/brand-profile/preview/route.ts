import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { requireAiQuota } from "@/lib/plan-limits";
import { AiRefusalError } from "@/lib/llm";
import { brandProfileInputSchema } from "@/lib/brand-schema";
import { BrandSourceError, PREVIEW_CHANNELS, previewSamplePost } from "@/lib/brand";

const bodySchema = z.object({
  channel: z.enum(PREVIEW_CHANNELS),
  // Unsaved edits from the form; falls back to the saved profile.
  draft: brandProfileInputSchema.optional(),
});

// POST /api/brand-profile/preview: write one sample post in the brand voice.
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Invalid preview request", { status: 400, code: "INVALID_REQUEST" });
    await requireAiQuota(user.businessId);
    try {
      const post = await previewSamplePost(user.businessId, parsed.data.channel, parsed.data.draft);
      return { post };
    } catch (e) {
      if (e instanceof BrandSourceError) throw new AppError(e.message, { status: 400, code: "BRAND_INCOMPLETE" });
      if (e instanceof AiRefusalError) {
        throw new AppError("The AI declined to write this post. Try adjusting the brand voice.", { status: 422, code: "AI_REFUSED" });
      }
      throw e;
    }
  });
}
