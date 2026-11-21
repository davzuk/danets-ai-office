// Scheduling a Content Studio post: one ScheduledPost per platform, each with
// a queue job set to fire at its time. See src/lib/social/publish/run.ts for
// what happens then.

import type { ScheduledPost, SocialAccount } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification, logActivity } from "@/lib/activity";
import { enqueue } from "@/lib/jobs/queue";
import { socialPublishJob } from "@/lib/jobs/handlers/social-publish";
import { IG_MAX_CAROUSEL } from "@/lib/social/publish/instagram";
import { igAspectIssue } from "@/lib/social/publish/media";
import { SCHEDULE_INCLUDE, variantMedia, type ScheduledRow } from "@/lib/social/publish/run";
import { normalizePolicy, scheduleDecision } from "./approval";
import { CONTENT_PLATFORMS, PLATFORM_RULES, composeText, hasErrors, type ContentPlatform } from "./platforms";
import { findOwnPost, getDontPhrases, toPublicPost } from "./posts";

export const SCHEDULE_STATUSES = ["pending_approval", "scheduled", "publishing", "published", "failed", "cancelled", "manual_due"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Statuses that still hold a slot on the calendar. */
export const LIVE_STATUSES: ScheduleStatus[] = ["pending_approval", "scheduled", "publishing", "manual_due"];

/** Content platform → the SocialAccount platform that can publish it automatically. */
export const PUBLISH_ACCOUNT_PLATFORM: Partial<Record<ContentPlatform, SocialAccount["platform"]>> = {
  facebook: "facebook_page",
  instagram: "instagram",
  // linkedin: "linkedin_page" once LinkedIn publishing (workstream L) lands
};

export const IG_DAILY_LIMIT = 25;
const DAY = 24 * 60 * 60_000;
const MAX_AHEAD = 366 * DAY;

type Actor = { userId: string; role: string; name: string; businessId: string };

const target = z.object({
  platform: z.enum(CONTENT_PLATFORMS),
  socialAccountId: z.string().max(64).nullish(),
});

export const scheduleSchema = z.object({
  /** ISO instant; omit with publishNow. */
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  publishNow: z.boolean().optional(),
  targets: z.array(target).min(1, "Pick at least one platform.").max(CONTENT_PLATFORMS.length),
});

export const rescheduleSchema = z.object({ scheduledFor: z.string().datetime({ offset: true }) });
export const markPostedSchema = z.object({
  permalink: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u === "" || /^https?:\/\/\S+$/i.test(u), "Enter the full link to the post.")
    .nullish(),
});

export function parseWhen(input: { scheduledFor?: string; publishNow?: boolean }, now = new Date()): Date {
  if (input.publishNow) return now;
  if (!input.scheduledFor) throw new AppError("Pick a date and time.", { status: 400, code: "NO_TIME" });
  const when = new Date(input.scheduledFor);
  if (Number.isNaN(when.getTime())) throw new AppError("That date isn't valid.", { status: 400, code: "BAD_TIME" });
  if (when.getTime() < now.getTime() - 60_000) throw new AppError("That time has already passed.", { status: 400, code: "PAST_TIME" });
  if (when.getTime() > now.getTime() + MAX_AHEAD) throw new AppError("Posts can be scheduled up to a year ahead.", { status: 400, code: "TOO_FAR" });
  return when;
}

export function publishDedupeKey(row: Pick<ScheduledPost, "id" | "scheduledFor">) {
  return `publish:${row.id}:${row.scheduledFor.toISOString()}`;
}

/** Queue the publish job and remember it on the row. */
export async function enqueuePublish(row: Pick<ScheduledPost, "id" | "businessId" | "scheduledFor">) {
  const job = await enqueue(
    socialPublishJob,
    { scheduledPostId: row.id },
    { businessId: row.businessId, runAt: row.scheduledFor, dedupeKey: publishDedupeKey(row) }
  );
  await db.scheduledPost.update({ where: { id: row.id }, data: { jobId: job.id } });
}

/** Drop a not-yet-started job. A job already running re-reads the row and stops. */
async function dropJob(row: Pick<ScheduledPost, "jobId">) {
  if (row.jobId) await db.job.deleteMany({ where: { id: row.jobId, status: "queued" } });
}

async function teamSize(businessId: string) {
  return db.businessUser.count({ where: { businessId } });
}

async function approvalPolicy(businessId: string) {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { contentApproval: true } });
  return normalizePolicy(b?.contentApproval);
}

// ─── Public shape ───────────────────────────────────────────────────────

export interface PublicSchedule {
  id: string;
  postId: string;
  postTitle: string;
  postStatus: string;
  platform: ContentPlatform;
  variantId: string;
  text: string;
  mediaIds: string[];
  account: { id: string; name: string; platform: string; status: string } | null;
  scheduledFor: string;
  status: ScheduleStatus;
  manual: boolean;
  permalink: string | null;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
  createdById: string | null;
}

export function toPublicSchedule(row: ScheduledRow): PublicSchedule {
  const platform = row.variant.platform as ContentPlatform;
  const hashtags = Array.isArray(row.variant.hashtags) ? row.variant.hashtags.filter((x): x is string => typeof x === "string") : [];
  const title = row.variant.post.title || row.variant.post.brief.split("\n")[0];
  return {
    id: row.id,
    postId: row.variant.post.id,
    postTitle: title.length > 80 ? title.slice(0, 77) + "…" : title,
    postStatus: row.variant.post.status,
    platform,
    variantId: row.variantId,
    text: PLATFORM_RULES[platform] ? composeText(platform, { body: row.variant.body, hashtags, linkUrl: row.variant.linkUrl }) : row.variant.body,
    mediaIds: Array.isArray(row.variant.mediaIds) ? row.variant.mediaIds.filter((x): x is string => typeof x === "string") : [],
    account: row.socialAccount
      ? { id: row.socialAccount.id, name: row.socialAccount.name, platform: row.socialAccount.platform, status: row.socialAccount.status }
      : null,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status as ScheduleStatus,
    manual: !row.socialAccountId,
    permalink: row.permalink,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    attempts: row.attempts,
    lastError: row.lastError,
    createdById: row.createdById,
  };
}

export async function listSchedules(businessId: string, opts: { from?: Date; to?: Date; postId?: string } = {}) {
  const rows = await db.scheduledPost.findMany({
    where: {
      businessId,
      ...(opts.from || opts.to ? { scheduledFor: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}),
      ...(opts.postId ? { variant: { postId: opts.postId } } : { status: { not: "cancelled" } }),
    },
    include: SCHEDULE_INCLUDE,
    orderBy: { scheduledFor: "asc" },
    take: 1000,
  });
  return rows.map(toPublicSchedule);
}

async function findOwnSchedule(businessId: string, id: string) {
  const row = await db.scheduledPost.findFirst({ where: { id, businessId }, include: SCHEDULE_INCLUDE });
  if (!row) throw new AppError("Scheduled post not found.", { status: 404, code: "NOT_FOUND" });
  return row;
}

function assertCanManage(actor: Actor, row: Pick<ScheduledPost, "createdById">) {
  if (actor.role !== "admin" && row.createdById !== actor.userId) throw new Error("FORBIDDEN");
}

// ─── Schedule ───────────────────────────────────────────────────────────

/** Account checks and per-platform media rules for an automatic publish. */
async function resolveAccount(
  businessId: string,
  platform: ContentPlatform,
  socialAccountId: string | null | undefined
): Promise<SocialAccount | null> {
  if (!socialAccountId) return null;
  const want = PUBLISH_ACCOUNT_PLATFORM[platform];
  if (!want) throw new AppError(`${PLATFORM_RULES[platform].label} can't be published automatically yet; schedule it as a reminder.`, { status: 400, code: "MANUAL_ONLY" });
  const acct = await db.socialAccount.findFirst({ where: { id: socialAccountId, businessId } });
  if (!acct || acct.platform !== want) throw new AppError("That account isn't connected to this workspace.", { status: 400, code: "BAD_ACCOUNT" });
  if (acct.status !== "active") throw new AppError(`${acct.name} needs reconnecting before it can publish.`, { status: 400, code: "ACCOUNT_ERROR" });
  if (!acct.publishEnabled) throw new AppError(`Publishing is turned off for ${acct.name}. Turn it on in Settings → Connections.`, { status: 400, code: "PUBLISH_OFF" });
  return acct;
}

async function checkInstagram(businessId: string, acct: SocialAccount, mediaIds: unknown, when: Date, excludeId?: string) {
  const media = await variantMedia(businessId, mediaIds as never);
  if (media.length === 0) throw new AppError("Instagram posts need at least one image or video.", { status: 400, code: "IG_NO_MEDIA" });
  if (media.length > IG_MAX_CAROUSEL) throw new AppError(`Instagram carousels take up to ${IG_MAX_CAROUSEL} items.`, { status: 400, code: "IG_TOO_MANY" });
  for (const m of media) {
    const issue = igAspectIssue(m);
    if (issue) throw new AppError(`${m.originalName || "An image"} ${issue}. Crop it between 4:5 and 1.91:1.`, { status: 400, code: "IG_ASPECT" });
  }
  const nearby = await db.scheduledPost.count({
    where: {
      socialAccountId: acct.id,
      status: { in: ["scheduled", "publishing", "published", "pending_approval"] },
      scheduledFor: { gt: new Date(when.getTime() - DAY), lt: new Date(when.getTime() + DAY) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (nearby >= IG_DAILY_LIMIT) {
    throw new AppError(`Instagram allows ${IG_DAILY_LIMIT} posts per account in 24 hours; ${acct.name} already has ${nearby} around then.`, {
      status: 400,
      code: "IG_DAILY_LIMIT",
    });
  }
}

export async function schedulePost(actor: Actor, postId: string, input: z.infer<typeof scheduleSchema>) {
  const post = await findOwnPost(actor.businessId, postId);
  if (post.status === "archived") throw new AppError("Restore the post before scheduling it.", { status: 400, code: "ARCHIVED" });
  const pub = toPublicPost(post, await getDontPhrases(actor.businessId));
  const when = parseWhen(input);

  const seen = new Set<string>();
  const plans: { variantId: string; platform: ContentPlatform; acct: SocialAccount | null }[] = [];
  for (const t of input.targets) {
    if (seen.has(t.platform)) throw new AppError("Each platform can be picked once.", { status: 400, code: "DUPLICATE_TARGET" });
    seen.add(t.platform);
    const v = pub.variants.find((x) => x.platform === t.platform);
    const label = PLATFORM_RULES[t.platform].label;
    if (!v) throw new AppError(`This post has no ${label} version.`, { status: 400, code: "NO_VARIANT" });
    if (hasErrors(v.issues)) throw new AppError(`Fix the problems on ${label} first.`, { status: 400, code: "VARIANT_ERRORS" });
    const acct = await resolveAccount(actor.businessId, t.platform, t.socialAccountId);
    if (acct && t.platform === "instagram") await checkInstagram(actor.businessId, acct, v.mediaIds, when);
    if (acct && t.platform === "facebook" && v.mediaIds.length > 0) {
      const media = await variantMedia(actor.businessId, v.mediaIds);
      if (media.some((m) => m.kind === "video") && media.length > 1) {
        throw new AppError("Facebook posts can have several photos or one video, not both.", { status: 400, code: "MEDIA_MIX" });
      }
    }
    plans.push({ variantId: v.id, platform: t.platform, acct });
  }

  const decision = scheduleDecision({
    policy: await approvalPolicy(actor.businessId),
    teamSize: await teamSize(actor.businessId),
    role: actor.role,
    postApproved: post.status === "approved",
  });
  const status: ScheduleStatus = decision === "needs_approval" ? "pending_approval" : "scheduled";
  const approvedNow = decision === "approve_and_schedule";

  const rows = await db.$transaction(async (tx) => {
    const created: ScheduledPost[] = [];
    for (const p of plans) {
      created.push(
        await tx.scheduledPost.create({
          data: {
            businessId: actor.businessId,
            variantId: p.variantId,
            socialAccountId: p.acct?.id ?? null,
            scheduledFor: when,
            status,
            createdById: actor.userId,
            ...(status === "scheduled" ? { approvedById: post.approvedById ?? actor.userId, approvedAt: post.approvedAt ?? new Date() } : {}),
          },
        })
      );
    }
    if (approvedNow) {
      await tx.contentPost.update({ where: { id: post.id }, data: { status: "approved", approvedById: actor.userId, approvedAt: new Date() } });
    } else if (status === "pending_approval" && post.status === "draft") {
      await tx.contentPost.update({ where: { id: post.id }, data: { status: "in_review" } });
    }
    return created;
  });

  if (status === "scheduled") for (const r of rows) await enqueuePublish(r);

  const platforms = plans.map((p) => PLATFORM_RULES[p.platform].label).join(", ");
  if (status === "pending_approval") {
    await createNotification({
      businessId: actor.businessId,
      type: "content_review",
      title: "Post waiting for approval",
      message: `${actor.name} scheduled "${pub.title}" for ${platforms}. It will go out once an admin approves it.`,
      data: { postId: post.id },
    });
  }
  await logActivity({
    businessId: actor.businessId,
    userId: actor.userId,
    userName: actor.name,
    action: input.publishNow ? "content.publish_now" : "content.scheduled",
    module: "social",
    description: `${input.publishNow ? "Published now" : "Scheduled"} "${pub.title}" for ${platforms}${status === "pending_approval" ? " (waiting for approval)" : ""}`,
    metadata: { postId: post.id, scheduledFor: when.toISOString(), scheduleIds: rows.map((r) => r.id), approvedNow },
  });

  return { decision, schedules: await listSchedules(actor.businessId, { postId: post.id }) };
}

/** Called when a post is approved: its waiting schedules go into the queue. */
export async function promoteApprovedPost(businessId: string, postId: string, approverId: string) {
  const waiting = await db.scheduledPost.findMany({
    where: { businessId, status: "pending_approval", variant: { postId } },
  });
  for (const w of waiting) {
    const now = new Date();
    const row = await db.scheduledPost.update({
      where: { id: w.id },
      // Missed its slot while waiting: publish as soon as it's approved.
      data: { status: "scheduled", approvedById: approverId, approvedAt: now, scheduledFor: w.scheduledFor < now ? now : w.scheduledFor },
    });
    await enqueuePublish(row);
  }
  return waiting.length;
}

export async function reschedule(actor: Actor, id: string, scheduledFor: string) {
  const row = await findOwnSchedule(actor.businessId, id);
  assertCanManage(actor, row);
  if (!["scheduled", "pending_approval", "failed", "manual_due"].includes(row.status)) {
    throw new AppError(row.status === "publishing" ? "This post is being published right now." : "This post can't be moved any more.", {
      status: 409,
      code: "NOT_MOVABLE",
    });
  }
  const when = parseWhen({ scheduledFor });
  if (row.socialAccount && row.variant.platform === "instagram") {
    await checkInstagram(actor.businessId, row.socialAccount, row.variant.mediaIds, when, row.id);
  }
  await dropJob(row);
  const nextStatus = row.status === "pending_approval" ? "pending_approval" : "scheduled";
  const updated = await db.scheduledPost.update({
    where: { id: row.id },
    data: { scheduledFor: when, status: nextStatus, jobId: null, ...(row.status === "failed" ? { lastError: null, attempts: 0 } : {}) },
  });
  if (nextStatus === "scheduled") await enqueuePublish(updated);
  return toPublicSchedule(await findOwnSchedule(actor.businessId, id));
}

export async function cancelSchedule(actor: Actor, id: string) {
  const row = await findOwnSchedule(actor.businessId, id);
  assertCanManage(actor, row);
  if (row.status === "publishing") throw new AppError("This post is being published right now.", { status: 409, code: "PUBLISHING" });
  if (row.status === "published") throw new AppError("This post is already live. Delete it on the platform itself.", { status: 409, code: "PUBLISHED" });
  await dropJob(row);
  await db.scheduledPost.update({ where: { id: row.id }, data: { status: "cancelled", jobId: null } });
  return { ok: true };
}

export async function retrySchedule(actor: Actor, id: string) {
  const row = await findOwnSchedule(actor.businessId, id);
  assertCanManage(actor, row);
  if (row.status !== "failed") throw new AppError("Only failed posts can be retried.", { status: 409, code: "NOT_FAILED" });
  if (row.socialAccount && row.socialAccount.status !== "active") {
    throw new AppError(`${row.socialAccount.name} needs reconnecting first.`, { status: 400, code: "ACCOUNT_ERROR" });
  }
  await dropJob(row);
  const updated = await db.scheduledPost.update({
    where: { id: row.id },
    data: { status: "scheduled", scheduledFor: new Date(), lastError: null, attempts: 0, jobId: null },
  });
  await enqueuePublish(updated);
  return toPublicSchedule(await findOwnSchedule(actor.businessId, id));
}

/** The team posted a manual (or failed) one by hand. */
export async function markPosted(actor: Actor, id: string, permalink: string | null | undefined) {
  const row = await findOwnSchedule(actor.businessId, id);
  if (!["manual_due", "scheduled", "failed"].includes(row.status)) {
    throw new AppError("This post can't be marked as posted.", { status: 409, code: "NOT_MARKABLE" });
  }
  await dropJob(row);
  await db.scheduledPost.update({
    where: { id: row.id },
    data: { status: "published", publishedAt: new Date(), permalink: permalink || null, jobId: null, lastError: null },
  });
  await logActivity({
    businessId: actor.businessId,
    userId: actor.userId,
    userName: actor.name,
    action: "content.marked_posted",
    module: "social",
    description: `Marked "${toPublicSchedule(row).postTitle}" as posted on ${PLATFORM_RULES[row.variant.platform as ContentPlatform]?.label ?? row.variant.platform}`,
    metadata: { scheduleId: row.id },
  });
  return toPublicSchedule(await findOwnSchedule(actor.businessId, id));
}

/** A platform version can't be removed while it's scheduled or already live. */
export async function assertVariantRemovable(variantId: string) {
  const n = await db.scheduledPost.count({ where: { variantId, status: { in: [...LIVE_STATUSES, "published"] } } });
  if (n > 0) {
    throw new AppError("This version is scheduled or already published. Cancel its schedule first.", { status: 409, code: "VARIANT_SCHEDULED" });
  }
}

/** A post can't be deleted while one of its versions is mid-publish. */
export async function assertPostDeletable(postId: string) {
  const n = await db.scheduledPost.count({ where: { status: "publishing", variant: { postId } } });
  if (n > 0) throw new AppError("This post is being published right now; try again in a minute.", { status: 409, code: "PUBLISHING" });
  const jobs = await db.scheduledPost.findMany({ where: { variant: { postId }, jobId: { not: null } }, select: { jobId: true } });
  for (const j of jobs) await dropJob(j);
}

/** Archiving a post takes its unpublished schedules off the calendar. */
export async function cancelPostSchedules(postId: string) {
  const rows = await db.scheduledPost.findMany({
    where: { variant: { postId }, status: { in: ["pending_approval", "scheduled", "manual_due", "failed"] } },
    select: { id: true, jobId: true },
  });
  for (const r of rows) await dropJob(r);
  if (rows.length) await db.scheduledPost.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "cancelled", jobId: null } });
  return rows.length;
}
