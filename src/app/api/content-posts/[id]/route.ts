import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity, createNotification } from "@/lib/activity";
import { assertTransition, findOwnPost, loadPublicPost, parseBody, titleFromBrief, updatePostSchema } from "@/lib/content/posts";
import { ownCampaignId } from "@/lib/campaigns/service";
import { assertPostDeletable, cancelPostSchedules, listSchedules, promoteApprovedPost } from "@/lib/content/schedule";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/content-posts/:id
export function GET(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const [post, schedules] = await Promise.all([loadPublicPost(user.businessId, id), listSchedules(user.businessId, { postId: id })]);
    return { post, schedules };
  });
}

// PATCH /api/content-posts/:id { title?, brief?, goal?, toneTweak?, campaignId?, status? }
export function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const input = await parseBody(req, updatePostSchema);
    const before = await loadPublicPost(user.businessId, id);
    const to = input.status;
    if (to) assertTransition(before, to, user.role, before.variants);

    await db.contentPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title || null } : {}),
        ...(input.brief !== undefined ? { brief: input.brief } : {}),
        ...(input.goal !== undefined ? { goal: input.goal ?? null } : {}),
        ...(input.toneTweak !== undefined ? { toneTweak: input.toneTweak || null } : {}),
        ...(input.campaignId !== undefined ? { campaignId: await ownCampaignId(user.businessId, input.campaignId) } : {}),
        ...(to && to !== before.status
          ? to === "approved"
            ? { status: to, approvedById: user.userId, approvedAt: new Date() }
            : { status: to, approvedById: null, approvedAt: null }
          : {}),
      },
    });

    if (to === "approved" && before.status !== "approved") await promoteApprovedPost(user.businessId, id, user.userId);
    if (to === "archived" && before.status !== "archived") await cancelPostSchedules(id);

    if (to && to !== before.status) {
      const title = before.title || titleFromBrief(before.brief);
      if (to === "in_review") {
        await createNotification({
          businessId: user.businessId,
          type: "content_review",
          title: "Post waiting for approval",
          message: `${user.name} sent "${title}" for approval.`,
          data: { postId: id },
        });
      }
      if (to === "approved" || (before.status === "approved" && to !== "archived")) {
        await logActivity({
          businessId: user.businessId,
          userId: user.userId,
          userName: user.name,
          action: to === "approved" ? "content.approved" : "content.unapproved",
          module: "social",
          description: `${to === "approved" ? "Approved" : "Withdrew approval for"} post "${title}"`,
          metadata: { postId: id, platforms: before.variants.map((v) => v.platform) },
        });
      }
    }
    return { post: await loadPublicPost(user.businessId, id) };
  });
}

// DELETE /api/content-posts/:id: admins, or whoever created it
export function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const post = await findOwnPost(user.businessId, id);
    if (user.role !== "admin" && post.createdById !== user.userId) throw new Error("FORBIDDEN");
    await assertPostDeletable(post.id);
    await db.contentPost.delete({ where: { id: post.id } });
    return { ok: true };
  });
}
