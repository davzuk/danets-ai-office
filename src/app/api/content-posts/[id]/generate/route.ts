import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { requireAiQuota } from "@/lib/plan-limits";
import { loadContentContext } from "@/lib/content/context";
import { generateVariants } from "@/lib/content/generate";
import { CONTENT_PLATFORMS, isContentPlatform } from "@/lib/content/platforms";
import { findOwnPost, loadPublicPost, parseBody, saveGeneratedVariants } from "@/lib/content/posts";

export const maxDuration = 120;

const schema = z.object({
  /** Platforms to (re)generate; defaults to the ones the post already has. */
  platforms: z.array(z.enum(CONTENT_PLATFORMS)).max(CONTENT_PLATFORMS.length).optional(),
  linkUrl: z.string().trim().max(2000).nullish(),
});

// POST /api/content-posts/:id/generate: regenerate all variants from the brief, or add platforms
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const input = await parseBody(req, schema);
    const post = await findOwnPost(user.businessId, id);
    const existing = post.variants.map((v) => v.platform).filter(isContentPlatform);
    const platforms = [...new Set(input.platforms?.length ? input.platforms : existing)];
    if (platforms.length === 0) platforms.push("facebook", "instagram", "linkedin");

    await requireAiQuota(user.businessId);
    const ctx = await loadContentContext(user.businessId, post.brief);
    const linkUrl =
      input.linkUrl !== undefined ? input.linkUrl || null : post.variants.find((v) => v.linkUrl)?.linkUrl ?? null;
    const result = await generateVariants(user.businessId, ctx, {
      brief: post.brief,
      goal: (post.goal as never) ?? null,
      toneTweak: post.toneTweak,
      linkUrl: linkUrl && /^https?:\/\//i.test(linkUrl) ? linkUrl : null,
      platforms,
    });
    await saveGeneratedVariants(post.id, result.variants);
    // New copy needs a fresh look.
    if (post.status !== "draft") {
      await db.contentPost.update({ where: { id: post.id }, data: { status: "draft", approvedById: null, approvedAt: null } });
    } else {
      await db.contentPost.update({ where: { id: post.id }, data: { updatedAt: new Date() } });
    }
    return { post: await loadPublicPost(user.businessId, post.id) };
  });
}
