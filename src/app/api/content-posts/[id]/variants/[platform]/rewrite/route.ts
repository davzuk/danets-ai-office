import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { requireAiQuota } from "@/lib/plan-limits";
import { loadContentContext } from "@/lib/content/context";
import { rewriteVariant } from "@/lib/content/generate";
import { isContentPlatform, type ContentGoal } from "@/lib/content/platforms";
import { findOwnPost, loadPublicPost, parseBody, rewriteSchema } from "@/lib/content/posts";

export const maxDuration = 120;

// POST /api/content-posts/:id/variants/:platform/rewrite { action, locale?, instruction? }
// "Regenerate this one", "Shorter", "Add CTA", "Translate to …" or a custom edit.
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string; platform: string }> }) {
  return withSession(async (user) => {
    const { id, platform } = await params;
    if (!isContentPlatform(platform)) throw new AppError("Unknown platform.", { status: 404, code: "NOT_FOUND" });
    const input = await parseBody(req, rewriteSchema);
    if (input.action === "translate" && !input.locale) {
      throw new AppError("Choose a language to translate into.", { status: 400, code: "INVALID_BODY" });
    }
    const post = await findOwnPost(user.businessId, id);
    const variant = post.variants.find((v) => v.platform === platform);
    if (!variant && input.action !== "regenerate") {
      throw new AppError("There's no copy for this platform yet. Generate it first.", { status: 400, code: "NO_VARIANT" });
    }

    await requireAiQuota(user.businessId);
    const ctx = await loadContentContext(user.businessId, post.brief);
    const hashtags = Array.isArray(variant?.hashtags) ? (variant.hashtags as string[]) : [];
    const result = await rewriteVariant(
      user.businessId,
      ctx,
      platform,
      { body: variant?.body ?? "", hashtags, linkUrl: variant?.linkUrl ?? null },
      input.action,
      {
        brief: post.brief,
        goal: (post.goal as ContentGoal | null) ?? null,
        toneTweak: post.toneTweak,
        locale: input.locale,
        instruction: input.instruction,
        linkUrl: variant?.linkUrl ?? null,
      }
    );

    const data = {
      body: result.body,
      hashtags: result.hashtags,
      imagePrompt: result.imagePrompt ?? variant?.imagePrompt ?? null,
      aiGenerated: true,
      editedByHuman: false,
    };
    await db.postVariant.upsert({
      where: { postId_platform: { postId: post.id, platform } },
      create: { postId: post.id, platform, linkUrl: result.linkUrl ?? null, ...data },
      update: data,
    });
    await db.contentPost.update({
      where: { id: post.id },
      data: post.status === "draft" ? { updatedAt: new Date() } : { status: "draft", approvedById: null, approvedAt: null },
    });
    return { post: await loadPublicPost(user.businessId, post.id) };
  });
}
