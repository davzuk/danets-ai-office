// What the social.publish job does with one ScheduledPost when its time comes.
// The row is the source of truth; the job only says "look at it now".

import type { MediaAsset, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification, logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { approvalRequired, normalizePolicy } from "@/lib/content/approval";
import { PLATFORM_RULES, composeText, type ContentPlatform } from "@/lib/content/platforms";
import { socialAccountToken } from "@/lib/social/accounts";
import { ConnectionUnavailableError, getAccessToken } from "@/lib/connections/tokens";
import { OAuthGrantError } from "@/lib/connections/types";
import { publishToFacebook } from "./facebook";
import { publishToInstagram } from "./instagram";
import { publishToLinkedIn, linkedinClient } from "./linkedin";
import { PublishError, graphClient, type FetchLike } from "./meta-http";
import { mediaForPlatform, readMediaBytes, unreachableMediaUrl } from "./media";
import { tagLink } from "@/lib/social/utm";

/** A job that fires earlier than this before the row's time is stale (the post was moved later). */
export const EARLY_TOLERANCE_MS = 30_000;

export type RunOutcome =
  | "missing"
  | "skipped"
  | "too_early"
  | "needs_approval"
  | "manual_due"
  | "published"
  | "failed"
  | "interrupted"
  /** a retryable error; the caller rethrows so the queue backs off */
  | "retry";

export const SCHEDULE_INCLUDE = {
  variant: { include: { post: { select: { id: true, title: true, brief: true, status: true, businessId: true, campaignTag: true } } } },
  socialAccount: true,
} satisfies Prisma.ScheduledPostInclude;

export type ScheduledRow = Prisma.ScheduledPostGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

export function postTitle(row: ScheduledRow) {
  const t = row.variant.post.title || row.variant.post.brief.split("\n")[0];
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

const label = (platform: string) => PLATFORM_RULES[platform as ContentPlatform]?.label ?? platform;

async function notifyFailure(row: ScheduledRow, message: string) {
  await createNotification({
    businessId: row.businessId,
    type: "content_publish_failed",
    title: `${label(row.variant.platform)} post failed`,
    message: `"${postTitle(row)}" wasn't published: ${message}`,
    data: { postId: row.variant.post.id, scheduledPostId: row.id },
  });
}

async function markFailed(row: ScheduledRow, message: string) {
  await db.scheduledPost.update({ where: { id: row.id }, data: { status: "failed", lastError: message.slice(0, 2000) } });
  await notifyFailure(row, message);
}

/** Load a variant's media in the order the user arranged it. */
export async function variantMedia(businessId: string, mediaIds: Prisma.JsonValue | null): Promise<MediaAsset[]> {
  const ids = Array.isArray(mediaIds) ? mediaIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return [];
  const rows = await db.mediaAsset.findMany({ where: { businessId, id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is MediaAsset => !!r);
}

/**
 * The token that publishes for an account: Meta Pages carry their own; LinkedIn
 * Pages use the connected member's token (refreshed when it's close to expiry).
 */
export async function publishToken(acct: NonNullable<ScheduledRow["socialAccount"]>): Promise<string> {
  const own = socialAccountToken(acct);
  if (own) return own;
  if (acct.platform !== "linkedin_page") throw new PublishError("The saved access token can't be read.", "auth");
  try {
    return await getAccessToken(acct.connectionId, acct.businessId);
  } catch (e) {
    if (e instanceof ConnectionUnavailableError || e instanceof OAuthGrantError) throw new PublishError(e.message, "auth");
    throw new PublishError((e as Error).message, "retry");
  }
}

export interface RunOptions {
  attempt: number;
  maxAttempts: number;
  now?: Date;
  fetchImpl?: FetchLike;
}

export async function runScheduledPost(scheduledPostId: string, opts: RunOptions): Promise<{ outcome: RunOutcome; error?: PublishError }> {
  const now = opts.now ?? new Date();
  const row = await db.scheduledPost.findUnique({ where: { id: scheduledPostId }, include: SCHEDULE_INCLUDE });
  if (!row) return { outcome: "missing" };

  if (row.status === "publishing") {
    // A previous run died mid-publish. It may or may not have reached Meta, so
    // don't post again blindly.
    await markFailed(row, "Publishing was interrupted. Check the page to see whether it went out before retrying.");
    return { outcome: "interrupted" };
  }
  if (row.status !== "scheduled") return { outcome: "skipped" };
  if (row.scheduledFor.getTime() - now.getTime() > EARLY_TOLERANCE_MS) return { outcome: "too_early" };

  const business = await db.business.findUnique({ where: { id: row.businessId }, select: { contentApproval: true } });
  const teamSize = await db.businessUser.count({ where: { businessId: row.businessId } });
  if (approvalRequired(normalizePolicy(business?.contentApproval), teamSize) && row.variant.post.status !== "approved") {
    await db.scheduledPost.update({ where: { id: row.id }, data: { status: "pending_approval", jobId: null } });
    await createNotification({
      businessId: row.businessId,
      type: "content_review",
      title: "Scheduled post waiting for approval",
      message: `"${postTitle(row)}" was due on ${label(row.variant.platform)} but hasn't been approved. Approve it to publish.`,
      data: { postId: row.variant.post.id, scheduledPostId: row.id },
    });
    return { outcome: "needs_approval" };
  }

  const acct = row.socialAccount;
  if (!acct) {
    await db.scheduledPost.update({ where: { id: row.id }, data: { status: "manual_due" } });
    await createNotification({
      businessId: row.businessId,
      type: "content_manual_due",
      title: `Time to post on ${label(row.variant.platform)}`,
      message: `"${postTitle(row)}" is due now. Copy the text from the calendar, post it, then mark it as posted.`,
      data: { postId: row.variant.post.id, scheduledPostId: row.id },
    });
    return { outcome: "manual_due" };
  }
  if (acct.status !== "active" || !acct.publishEnabled) {
    await markFailed(
      row,
      acct.status !== "active" ? `${acct.name} needs reconnecting in Settings → Connections.` : `Publishing is turned off for ${acct.name}.`
    );
    return { outcome: "failed" };
  }

  const claimed = await db.scheduledPost.updateMany({
    where: { id: row.id, status: "scheduled" },
    data: { status: "publishing", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { outcome: "skipped" };

  const platform = row.variant.platform as ContentPlatform;
  try {
    const token = await publishToken(acct);

    const assets = await variantMedia(row.businessId, row.variant.mediaIds);
    const media = await mediaForPlatform(platform, assets);
    // Meta fetches media by URL; LinkedIn is sent the bytes.
    if (platform !== "linkedin" && media.some((m) => unreachableMediaUrl(m.url))) {
      throw new PublishError(
        "Media is stored at a local address Meta can't fetch. Use S3 storage or a public NEXT_PUBLIC_APP_URL.",
        "content"
      );
    }
    const hashtags = Array.isArray(row.variant.hashtags) ? row.variant.hashtags.filter((x): x is string => typeof x === "string") : [];
    // UTM-tag the link so leads who arrive through it count toward this post.
    const linkUrl = tagLink(row.variant.linkUrl, {
      platform,
      scheduledPostId: row.id,
      postId: row.variant.post.id,
      campaignTag: row.variant.post.campaignTag,
    });
    const text = composeText(platform, { body: row.variant.body, hashtags, linkUrl });
    const input = { externalId: acct.externalId, text, linkUrl, media, containerId: row.containerId };

    let result;
    if (platform === "facebook") {
      result = await publishToFacebook(graphClient(token, process.env, opts.fetchImpl), input);
    } else if (platform === "instagram") {
      result = await publishToInstagram(graphClient(token, process.env, opts.fetchImpl), input, {
        onContainer: async (id) => {
          await db.scheduledPost.update({ where: { id: row.id }, data: { containerId: id } });
        },
      });
    } else if (platform === "linkedin") {
      const byUrl = new Map(assets.map((a) => [a.url, a]));
      result = await publishToLinkedIn(linkedinClient(token, process.env, opts.fetchImpl), {
        ...input,
        linkTitle: postTitle(row),
        readMedia: async (m) => {
          const asset = byUrl.get(m.url);
          if (!asset) throw new PublishError("A media file is missing.", "content");
          return new Uint8Array(await readMediaBytes(asset));
        },
      });
    } else {
      throw new PublishError(`${label(platform)} can't be published automatically yet.`, "content");
    }

    await db.scheduledPost.update({
      where: { id: row.id },
      data: {
        status: "published",
        externalPostId: result.externalPostId,
        permalink: result.permalink,
        publishedAt: new Date(),
        lastError: null,
        jobId: null,
      },
    });
    await logActivity({
      businessId: row.businessId,
      userId: row.createdById ?? undefined,
      userName: "Scheduler",
      action: "content.published",
      module: "social",
      description: `Published "${postTitle(row)}" to ${acct.name} (${label(platform)})`,
      metadata: { postId: row.variant.post.id, scheduledPostId: row.id, externalPostId: result.externalPostId },
    });
    return { outcome: "published" };
  } catch (e) {
    const err = e instanceof PublishError ? e : new PublishError((e as Error)?.message || "Unexpected error", "retry");
    logger.warn("Social publish failed", { scheduledPostId: row.id, kind: err.kind, code: err.code, subcode: err.subcode, error: err.message });

    if (err.kind === "auth") {
      // A LinkedIn Page shares the member's connection; the connection itself is
      // marked by the token layer, the Page shows why its post failed.
      await db.socialAccount.update({
        where: { id: acct.id },
        data: { status: "error", lastError: `Publishing failed: ${err.message}`.slice(0, 2000) },
      });
      await markFailed(row, `${acct.name} needs reconnecting (${err.message}).`);
      return { outcome: "failed", error: err };
    }
    if (err.kind === "retry" && opts.attempt < opts.maxAttempts) {
      await db.scheduledPost.update({ where: { id: row.id }, data: { status: "scheduled", lastError: err.message.slice(0, 2000) } });
      return { outcome: "retry", error: err };
    }
    await markFailed(row, err.message);
    return { outcome: "failed", error: err };
  }
}
