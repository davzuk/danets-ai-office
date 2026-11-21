import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { isContentPlatform } from "@/lib/content/platforms";
import { findOwnPost, loadPublicPost, parseBody, updateVariantSchema, validateMediaIds, variantUpdateData } from "@/lib/content/posts";
import { assertVariantRemovable } from "@/lib/content/schedule";

type Ctx = { params: Promise<{ id: string; platform: string }> };

async function resolve(businessId: string, params: Ctx["params"]) {
  const { id, platform } = await params;
  if (!isContentPlatform(platform)) throw new AppError("Unknown platform.", { status: 404, code: "NOT_FOUND" });
  const post = await findOwnPost(businessId, id);
  return { post, platform, variant: post.variants.find((v) => v.platform === platform) ?? null };
}

// PATCH /api/content-posts/:id/variants/:platform { body?, hashtags?, mediaIds?, linkUrl?, imagePrompt? }
// Creates the variant if the platform isn't on the post yet (writing it by hand).
export function PATCH(req: NextRequest, ctx: Ctx) {
  return withSession(async (user) => {
    const { post, platform, variant } = await resolve(user.businessId, ctx.params);
    const input = await parseBody(req, updateVariantSchema);
    const mediaIds = input.mediaIds !== undefined ? await validateMediaIds(user.businessId, platform, input.mediaIds) : undefined;
    const data = variantUpdateData(platform, input, mediaIds);

    if (variant) {
      await db.postVariant.update({ where: { id: variant.id }, data });
    } else {
      await db.postVariant.create({
        data: {
          postId: post.id,
          platform,
          body: input.body ?? "",
          hashtags: (data.hashtags as string[] | undefined) ?? [],
          mediaIds: mediaIds ?? [],
          linkUrl: (data.linkUrl as string | null | undefined) ?? null,
          imagePrompt: input.imagePrompt ?? null,
          aiGenerated: false,
          editedByHuman: true,
        },
      });
    }
    // Editing approved copy sends it back to draft.
    await db.contentPost.update({
      where: { id: post.id },
      data: post.status === "approved" || post.status === "in_review" ? { status: "draft", approvedById: null, approvedAt: null } : { updatedAt: new Date() },
    });
    return { post: await loadPublicPost(user.businessId, post.id) };
  });
}

// DELETE /api/content-posts/:id/variants/:platform: drop a platform from the post
export function DELETE(_req: NextRequest, ctx: Ctx) {
  return withSession(async (user) => {
    const { post, variant } = await resolve(user.businessId, ctx.params);
    if (variant) await assertVariantRemovable(variant.id);
    if (variant) await db.postVariant.delete({ where: { id: variant.id } });
    return { post: await loadPublicPost(user.businessId, post.id) };
  });
}
