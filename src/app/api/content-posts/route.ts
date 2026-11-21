import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { checkMonthlyAiQuota, requireAiQuota } from "@/lib/plan-limits";
import { loadContentContext } from "@/lib/content/context";
import { generateVariants } from "@/lib/content/generate";
import { POST_STATUSES, createPostSchema, loadPublicPost, parseBody, saveGeneratedVariants, titleFromBrief } from "@/lib/content/posts";

// Opus-class generation plus one possible re-ask.
export const maxDuration = 120;

// GET /api/content-posts?status=draft|in_review|approved|archived: the Studio's post list + AI credits
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const status = req.nextUrl.searchParams.get("status");
    const [posts, credits] = await Promise.all([
      db.contentPost.findMany({
        where: {
          businessId: user.businessId,
          status: status && (POST_STATUSES as readonly string[]).includes(status) ? status : { not: "archived" },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          brief: true,
          status: true,
          goal: true,
          campaignTag: true,
          updatedAt: true,
          variants: { select: { platform: true } },
        },
      }),
      checkMonthlyAiQuota(user.businessId),
    ]);
    return {
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title || titleFromBrief(p.brief),
        status: p.status,
        goal: p.goal,
        campaignTag: p.campaignTag,
        platforms: p.variants.map((v) => v.platform),
        updatedAt: p.updatedAt.toISOString(),
      })),
      credits: { used: credits.used, limit: credits.limit, remaining: credits.remaining },
      canApprove: user.role === "admin",
    };
  });
}

// POST /api/content-posts: create a post from a brief and generate its variants
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const input = await parseBody(req, createPostSchema);
    await requireAiQuota(user.businessId);
    const ctx = await loadContentContext(user.businessId, input.brief);
    const linkUrl = input.linkUrl || null;
    // Generate before creating the row, so a failed generation leaves nothing behind.
    const result = await generateVariants(user.businessId, ctx, {
      brief: input.brief,
      goal: input.goal ?? null,
      toneTweak: input.toneTweak ?? null,
      linkUrl,
      platforms: [...new Set(input.platforms)],
    });
    const post = await db.contentPost.create({
      data: {
        businessId: user.businessId,
        brief: input.brief,
        goal: input.goal ?? null,
        toneTweak: input.toneTweak || null,
        campaignTag: input.campaignTag || null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        createdById: user.userId,
      },
    });
    await saveGeneratedVariants(post.id, result.variants);
    return { post: await loadPublicPost(user.businessId, post.id) };
  });
}
