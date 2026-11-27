import "server-only";
// Business Profile reviews (Phase 3, workstream X): sync from Google, the
// reviews inbox, AI-drafted replies in the brand voice, the approval policy
// and posting replies back to Google.

import { z } from "zod";
import type { BusinessLocation, GbpReview, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification, logActivity } from "@/lib/activity";
import { logger, serializeError } from "@/lib/logger";
import { aiStructured, AiRefusalError, logUsage } from "@/lib/llm";
import { getBrandContext, getBrandProfileRow } from "@/lib/brand";
import { approvalRequired, canSelfApprove, normalizePolicy } from "@/lib/content/approval";
import { findBannedPhrases } from "@/lib/content/platforms";
import { fireTrigger } from "@/lib/automation";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import { classifyGoogleError, NOT_APPROVED_MESSAGE } from "./google";
import { listReviewsPage, putReviewReply, replyTooLong, v4LocationPath, type GbpReviewData } from "./gbp";
import { googleProblem } from "./setup";

export interface ReviewActor {
  businessId: string;
  userId?: string;
  name: string;
  role: string;
}

const log = (a: ReviewActor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.userId, userName: a.name, action, module: "seo", description, metadata });

export const REPLY_FEATURE = "gbp_reply";
/** Pages of 50 read on a location's first sync, and on later ones before stopping. */
const FIRST_SYNC_PAGES = 10;
const LATER_SYNC_PAGES = 4;

export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

// ─── Sync ────────────────────────────────────────────────────────────

/** What a synced review changes on our row. Pure; exported for tests. */
export function reviewRowUpdate(existing: Pick<GbpReview, "replyStatus" | "replyText"> | null, r: GbpReviewData) {
  const base = {
    reviewerName: r.reviewerName,
    reviewerPhoto: r.reviewerPhoto,
    anonymous: r.anonymous,
    starRating: r.starRating,
    comment: r.comment,
    reviewCreatedAt: r.createdAt,
    reviewUpdatedAt: r.updatedAt,
  };
  if (r.reply) {
    // A reply on Google (ours, or one written in Google's own UI) is the truth.
    // A draft or pending edit of it stays as it is.
    const keep = existing && (existing.replyStatus === "draft" || existing.replyStatus === "pending_approval");
    return { ...base, replyText: r.reply.text, repliedAt: r.reply.at, replyState: r.reply.state, ...(keep ? {} : { replyStatus: "posted", replyError: null }) };
  }
  // No reply on Google. If we had one, it was deleted there.
  const hadReply = !!existing?.replyText;
  return {
    ...base,
    replyText: null,
    repliedAt: null,
    replyState: null,
    ...(hadReply && existing?.replyStatus === "posted" ? { replyStatus: "none" } : {}),
  };
}

/** A contact whose name matches the reviewer's exactly (and only one does). */
async function matchContact(businessId: string, name: string | null): Promise<string | null> {
  if (!name || name.length < 3) return null;
  const rows = await db.contact.findMany({ where: { businessId, name }, select: { id: true }, take: 2 });
  return rows.length === 1 ? rows[0].id : null;
}

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  notified: number;
}

export interface SyncOptions {
  /** Replaces the Google call (tests). */
  fetchPage?: (pageToken: string | null) => ReturnType<typeof listReviewsPage>;
  now?: Date;
}

/**
 * Pull a location's reviews forward, newest updates first, stopping at the
 * newest update seen last time. New reviews notify the team (1-2 stars are
 * urgent) and fire the review_received automation trigger, except on the
 * very first sync, which imports quietly.
 */
export async function syncLocationReviews(locationId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const loc = await db.businessLocation.findUnique({ where: { id: locationId } });
  const result: SyncResult = { fetched: 0, created: 0, updated: 0, notified: 0 };
  if (!loc || loc.status === "lost_access") return result;
  const ref = { businessId: loc.businessId, connectionId: loc.connectionId };
  const path = v4LocationPath(loc.accountName, loc.locationName);
  const fetchPage = opts.fetchPage ?? ((t: string | null) => listReviewsPage(ref, path, t));
  const firstSync = !loc.reviewsSyncedThrough;
  const since = loc.reviewsSyncedThrough?.getTime() ?? 0;

  const fresh: GbpReview[] = [];
  let newest = since;
  let average: number | null = null;
  let total: number | null = null;
  let pageToken: string | null = null;
  try {
    for (let page = 0; page < (firstSync ? FIRST_SYNC_PAGES : LATER_SYNC_PAGES); page++) {
      const r = await fetchPage(pageToken);
      if (page === 0) {
        average = r.averageRating;
        total = r.totalReviewCount;
      }
      let reachedSeen = false;
      for (const rev of r.reviews) {
        result.fetched++;
        newest = Math.max(newest, rev.updatedAt.getTime());
        if (rev.updatedAt.getTime() <= since) {
          reachedSeen = true;
          continue;
        }
        const existing = await db.gbpReview.findUnique({ where: { locationId_reviewName: { locationId: loc.id, reviewName: rev.reviewName } } });
        if (existing) {
          await db.gbpReview.update({ where: { id: existing.id }, data: reviewRowUpdate(existing, rev) });
          result.updated++;
        } else {
          const row = await db.gbpReview.create({
            data: {
              businessId: loc.businessId,
              locationId: loc.id,
              reviewName: rev.reviewName.slice(0, 400),
              ...reviewRowUpdate(null, rev),
              replyStatus: rev.reply ? "posted" : "none",
              contactId: await matchContact(loc.businessId, rev.reviewerName),
            },
          });
          fresh.push(row);
          result.created++;
        }
      }
      pageToken = r.nextPageToken;
      if (reachedSeen || !pageToken) break;
    }
  } catch (e) {
    await db.businessLocation.update({ where: { id: loc.id }, data: { reviewsError: syncErrorMessage(e) } });
    throw e;
  }

  await db.businessLocation.update({
    where: { id: loc.id },
    data: {
      reviewsSyncedAt: opts.now ?? new Date(),
      reviewsSyncedThrough: newest ? new Date(newest) : loc.reviewsSyncedThrough,
      reviewsError: null,
      ...(average !== null ? { averageRating: average } : {}),
      ...(total !== null ? { totalReviewCount: total } : {}),
    },
  });

  if (!firstSync && fresh.length) {
    result.notified = await announce(loc, fresh);
    await autoReplyAll(loc, fresh);
  }
  return result;
}

export function syncErrorMessage(e: unknown): string {
  if (e instanceof ConnectionUnavailableError) return "The Google connection needs reconnecting.";
  const kind = classifyGoogleError(e);
  if (kind === "not_approved") return NOT_APPROVED_MESSAGE;
  if (kind === "lost_access") return "The connected Google account can no longer read this location's reviews.";
  return "Google didn't answer the last reviews sync. It will try again.";
}

const stars = (n: number) => (n > 0 ? `${n}★` : "unrated");

async function announce(loc: BusinessLocation, fresh: GbpReview[]): Promise<number> {
  let sent = 0;
  const urgent = fresh.filter((r) => r.starRating > 0 && r.starRating <= 2);
  for (const r of urgent) {
    await createNotification({
      businessId: loc.businessId,
      type: "review_urgent",
      title: `${stars(r.starRating)} review needs a reply`,
      message: `${r.reviewerName ?? "Someone"} left ${loc.title} a ${r.starRating}-star review${r.comment ? `: "${r.comment.slice(0, 140)}${r.comment.length > 140 ? "…" : ""}"` : "."}`,
      data: { reviewId: r.id, locationId: loc.id },
    });
    sent++;
  }
  const rest = fresh.filter((r) => !urgent.includes(r));
  if (rest.length === 1) {
    const r = rest[0];
    await createNotification({
      businessId: loc.businessId,
      type: "review_new",
      title: `New ${stars(r.starRating)} review`,
      message: `${r.reviewerName ?? "Someone"} reviewed ${loc.title}${r.comment ? `: "${r.comment.slice(0, 140)}${r.comment.length > 140 ? "…" : ""}"` : "."}`,
      data: { reviewId: r.id, locationId: loc.id },
    });
    sent++;
  } else if (rest.length > 1) {
    await createNotification({
      businessId: loc.businessId,
      type: "review_new",
      title: `${rest.length} new reviews`,
      message: `${loc.title} has ${rest.length} new reviews on Google.`,
      data: { locationId: loc.id },
    });
    sent++;
  }
  for (const r of fresh) {
    const lead = r.contactId ? await db.lead.findFirst({ where: { contactId: r.contactId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }) : null;
    await fireTrigger("review_received", {
      businessId: loc.businessId,
      reviewId: r.id,
      rating: r.starRating,
      reviewerName: r.reviewerName ?? undefined,
      locationId: loc.id,
      locationTitle: loc.title,
      leadId: lead?.id,
      leadName: lead?.name ?? r.reviewerName ?? undefined,
    });
  }
  return sent;
}

// ─── Auto-reply ──────────────────────────────────────────────────────

const AUTO_THANKS = [
  "Thank you{name}! We really appreciate you taking the time to rate us.",
  "Thanks so much{name}, it means a lot to the team.",
  "Thank you{name} for the great rating. We look forward to seeing you again.",
];

/** The thank-you for a 4-5 star review with no text. Pure; the variant is picked from the review id so it's stable. */
export function autoThanks(reviewId: string, reviewerName: string | null): string {
  let h = 0;
  for (const ch of reviewId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const name = firstName(reviewerName);
  return AUTO_THANKS[h % AUTO_THANKS.length].replace("{name}", name ? `, ${name}` : "");
}

export const autoReplyEligible = (r: Pick<GbpReview, "starRating" | "comment" | "replyText">) => r.starRating >= 4 && !r.comment?.trim() && !r.replyText;

async function autoReplyAll(loc: BusinessLocation, fresh: GbpReview[]) {
  const settings = await db.seoSettings.findUnique({ where: { businessId: loc.businessId }, select: { autoReplyNoText: true } });
  if (!settings?.autoReplyNoText) return;
  const business = await db.business.findUnique({ where: { id: loc.businessId }, select: { contentApproval: true } });
  // "Every post needs an admin's approval" covers replies too: queue them instead.
  const mustApprove = normalizePolicy(business?.contentApproval) === "always";
  for (const r of fresh.filter(autoReplyEligible)) {
    const text = autoThanks(r.id, r.reviewerName);
    try {
      if (mustApprove) {
        await db.gbpReview.update({ where: { id: r.id }, data: { draftReply: text, draftedByName: "Auto-reply", replyStatus: "pending_approval", autoReplied: true } });
      } else {
        await publishReply(loc, r, text, { name: "Auto-reply" });
        await db.gbpReview.update({ where: { id: r.id }, data: { autoReplied: true } });
      }
    } catch (e) {
      logger.warn("Review auto-reply failed", { reviewId: r.id, ...serializeError(e) });
    }
  }
}

// ─── Inbox ───────────────────────────────────────────────────────────

export const publicReview = (r: GbpReview & { location?: { title: string } | null }) => ({
  id: r.id,
  locationId: r.locationId,
  locationTitle: r.location?.title ?? null,
  reviewerName: r.reviewerName,
  reviewerPhoto: r.reviewerPhoto,
  anonymous: r.anonymous,
  starRating: r.starRating,
  comment: r.comment,
  createdAt: r.reviewCreatedAt,
  updatedAt: r.reviewUpdatedAt,
  replyText: r.replyText,
  repliedAt: r.repliedAt,
  replyState: r.replyState,
  replyStatus: r.replyStatus,
  draftReply: r.draftReply,
  draftedByName: r.draftedByName,
  replyError: r.replyError,
  autoReplied: r.autoReplied,
  contactId: r.contactId,
});

export const inboxQuery = z.object({
  filter: z.enum(["all", "unreplied", "needs_approval", "low"]).default("all"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  locationId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const PAGE_SIZE = 20;

export function inboxWhere(businessId: string, q: z.infer<typeof inboxQuery>): Prisma.GbpReviewWhereInput {
  return {
    businessId,
    ...(q.locationId ? { locationId: q.locationId } : {}),
    ...(q.rating ? { starRating: q.rating } : {}),
    ...(q.filter === "unreplied" ? { replyText: null } : {}),
    ...(q.filter === "needs_approval" ? { replyStatus: "pending_approval" } : {}),
    ...(q.filter === "low" ? { starRating: { gte: 1, lte: 2 } } : {}),
  };
}

export async function reviewsData(businessId: string, q: z.infer<typeof inboxQuery>, now = new Date()) {
  const where = inboxWhere(businessId, q);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const [locations, rows, total, unreplied, needsApproval, settings, requests, clicked, recent] = await Promise.all([
    db.businessLocation.findMany({
      where: { businessId },
      orderBy: { title: "asc" },
      select: { id: true, title: true, status: true, error: true, averageRating: true, totalReviewCount: true, reviewsSyncedAt: true, reviewsError: true, reviewUri: true, mapsUri: true },
    }),
    db.gbpReview.findMany({ where, orderBy: { reviewCreatedAt: "desc" }, skip: (q.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { location: { select: { title: true } } } }),
    db.gbpReview.count({ where }),
    db.gbpReview.count({ where: { businessId, replyText: null } }),
    db.gbpReview.count({ where: { businessId, replyStatus: "pending_approval" } }),
    db.seoSettings.findUnique({ where: { businessId }, select: { autoReplyNoText: true } }),
    db.reviewRequest.count({ where: { businessId, sentAt: { gte: since30 } } }),
    db.reviewRequest.count({ where: { businessId, sentAt: { gte: since30 }, clickedAt: { not: null } } }),
    db.gbpReview.count({ where: { businessId, reviewCreatedAt: { gte: since30 } } }),
  ]);
  return {
    locations,
    reviews: rows.map(publicReview),
    page: q.page,
    pageSize: PAGE_SIZE,
    total,
    counts: { unreplied, needsApproval, last30: recent },
    requests: { sent30: requests, clicked30: clicked },
    settings: { autoReplyNoText: settings?.autoReplyNoText ?? false },
  };
}

async function loadReview(businessId: string, id: string) {
  const r = await db.gbpReview.findFirst({ where: { id, businessId }, include: { location: true } });
  if (!r) throw new AppError("Review not found.", { status: 404, code: "NOT_FOUND" });
  return r;
}

// ─── AI drafts ───────────────────────────────────────────────────────

const draftSchema = z.object({ reply: z.string().min(1).max(2000) });

/** The instructions for a reply draft. Pure; exported for tests. */
export function replyPrompt(args: {
  businessName: string;
  brand: string;
  phone: string | null;
  email: string | null;
  locationTitle: string;
  rating: number;
  reviewerName: string | null;
  comment: string | null;
  dontPhrases: string[];
}) {
  const low = args.rating > 0 && args.rating <= 2;
  const mixed = args.rating === 3;
  const contact = [args.phone && `phone ${args.phone}`, args.email && `email ${args.email}`].filter(Boolean).join(" or ");
  const system = `You write the business owner's public reply to a Google review of ${args.businessName}. Reply as the business, in its voice. Reply with JSON only.

Rules:
- Thank the reviewer${args.reviewerName ? " by first name" : ""}, and respond to the specific things they mention. Don't repeat the review back.
- Never promise refunds, discounts, compensation or anything else, and never admit fault or legal liability.
- Never mention other customers, staff by full name, or private details about the reviewer or their booking.
- Plain text, no hashtags, no links, no sign-off with a person's name. Keep it short: 1-3 sentences for short reviews, at most about 90 words.
${
  low
    ? `- This is a low rating. Stay calm and kind, say you're sorry they had a poor experience without accepting blame, and invite them to get in touch so you can look into it${contact ? ` (${contact})` : ""}. Don't argue or explain away their points.`
    : mixed
      ? `- This is a mixed rating. Thank them for the good points, acknowledge what fell short without accepting blame, and invite them back${contact ? ` or to get in touch (${contact})` : ""}.`
      : "- This is a positive rating. Be warm and genuine, and invite them back."
}${args.dontPhrases.length ? `\n- Never use these phrases: ${args.dontPhrases.map((p) => `"${p}"`).join(", ")}.` : ""}

Brand voice:
${args.brand || "No brand voice profile has been set up: write in a clear, friendly, professional voice."}`;
  const user = `Location: ${args.locationTitle}
Rating: ${args.rating > 0 ? `${args.rating} of 5 stars` : "not given"}
Reviewer: ${args.reviewerName ?? "(anonymous)"}
Review: ${args.comment ? `"""\n${args.comment.slice(0, 3000)}\n"""` : "(no text, rating only)"}

Return {"reply": string}.`;
  return { system, user };
}

const toStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);

export async function draftReply(actor: ReviewActor, id: string) {
  const r = await loadReview(actor.businessId, id);
  const [business, brand, profile] = await Promise.all([
    db.business.findUnique({ where: { id: actor.businessId }, select: { name: true, phone: true, email: true } }),
    getBrandContext(actor.businessId),
    getBrandProfileRow(actor.businessId),
  ]);
  const dontPhrases = toStrings(profile?.dontPhrases);
  const { system, user } = replyPrompt({
    businessName: business?.name ?? "the business",
    brand,
    phone: business?.phone ?? null,
    email: business?.email ?? null,
    locationTitle: r.location.title,
    rating: r.starRating,
    reviewerName: r.anonymous ? null : r.reviewerName,
    comment: r.comment,
    dontPhrases,
  });
  let result;
  try {
    result = await aiStructured(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      draftSchema,
      { businessId: actor.businessId, task: "content", maxTokens: 800 }
    );
    await logUsage(actor.businessId, REPLY_FEATURE, result);
  } catch (e) {
    await logUsage(actor.businessId, REPLY_FEATURE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", (e as Error).message);
    if (e instanceof AiRefusalError) throw new AppError("The AI declined to draft a reply to this review. Write one yourself.", { status: 422, code: "AI_REFUSED" });
    throw new AppError("The AI couldn't draft a reply just now. Please try again.", { status: 502, code: "AI_FAILED" });
  }
  const text = result.data.reply.trim();
  const banned = findBannedPhrases(text, dontPhrases);
  const updated = await db.gbpReview.update({
    where: { id: r.id },
    data: { draftReply: text, draftedById: actor.userId ?? null, draftedByName: actor.name.slice(0, 120), replyStatus: "draft", replyError: null },
    include: { location: { select: { title: true } } },
  });
  return { review: publicReview(updated), warnings: banned.map((p) => `Uses "${p}", which the brand voice says never to say.`) };
}

// ─── Replying ────────────────────────────────────────────────────────

export const replySchema = z.object({ text: z.string().trim().min(2, "Write a reply first.").max(4000) });

export type ReplyDecision = "post" | "needs_approval";

/** Post now, or wait for an admin, under the tenant's content approval policy. Pure. */
export function replyDecision(policy: string | null | undefined, teamSize: number, role: string): ReplyDecision {
  const p = normalizePolicy(policy);
  if (!approvalRequired(p, teamSize)) return "post";
  return canSelfApprove(p, role) ? "post" : "needs_approval";
}

function checkReplyText(text: string) {
  if (replyTooLong(text)) throw new AppError("Google allows replies up to about 4,000 characters. Shorten it.", { status: 400, code: "REPLY_TOO_LONG" });
}

/** Send a reply to Google and record it. */
export async function publishReply(loc: BusinessLocation, r: GbpReview, text: string, by: { userId?: string; name: string }) {
  checkReplyText(text);
  try {
    const out = await putReviewReply({ businessId: loc.businessId, connectionId: loc.connectionId }, r.reviewName, text);
    const updated = await db.gbpReview.update({
      where: { id: r.id },
      data: { replyText: out.text, repliedAt: out.at, replyState: out.state, replyStatus: "posted", draftReply: null, replyError: null },
      include: { location: { select: { title: true } } },
    });
    await logActivity({
      businessId: loc.businessId,
      userId: by.userId,
      userName: by.name,
      action: "review_replied",
      module: "seo",
      description: `Replied to ${r.reviewerName ?? "a"}'s ${r.starRating}-star review of ${loc.title}`,
      metadata: { reviewId: r.id },
    });
    return updated;
  } catch (e) {
    const problem = googleProblem(e, "this review");
    await db.gbpReview.update({ where: { id: r.id }, data: { replyStatus: "failed", draftReply: text, replyError: problem.message.slice(0, 2000) } });
    throw problem;
  }
}

export async function submitReply(actor: ReviewActor, id: string, text: string) {
  const r = await loadReview(actor.businessId, id);
  checkReplyText(text);
  const [business, teamSize] = await Promise.all([
    db.business.findUnique({ where: { id: actor.businessId }, select: { contentApproval: true } }),
    db.businessUser.count({ where: { businessId: actor.businessId } }),
  ]);
  if (replyDecision(business?.contentApproval, teamSize, actor.role) === "needs_approval") {
    const updated = await db.gbpReview.update({
      where: { id: r.id },
      data: { draftReply: text, draftedById: actor.userId ?? null, draftedByName: actor.name.slice(0, 120), replyStatus: "pending_approval", replyError: null },
      include: { location: { select: { title: true } } },
    });
    await createNotification({
      businessId: actor.businessId,
      type: "content_review",
      title: "Review reply waiting for approval",
      message: `${actor.name} wrote a reply to ${r.reviewerName ?? "a"}'s ${r.starRating}-star review of ${r.location.title}. Approve it to post it on Google.`,
      data: { reviewId: r.id },
    });
    await log(actor, "review_reply_submitted", `Submitted a reply to ${r.reviewerName ?? "a"}'s review for approval`, { reviewId: r.id });
    return { review: publicReview(updated), posted: false };
  }
  const updated = await publishReply(r.location, r, text, actor);
  return { review: publicReview(updated), posted: true };
}

/** An admin approves a waiting reply (optionally edited) and it posts. */
export async function approveReply(actor: ReviewActor, id: string, text?: string) {
  if (actor.role !== "admin") throw new AppError("Only admins can approve replies.", { status: 403, code: "FORBIDDEN" });
  const r = await loadReview(actor.businessId, id);
  const body = (text ?? r.draftReply ?? "").trim();
  if (!body) throw new AppError("There's no reply to approve.", { status: 400, code: "NO_DRAFT" });
  const updated = await publishReply(r.location, r, body, actor);
  return { review: publicReview(updated), posted: true };
}

/** Throw away a draft or a waiting reply. */
export async function discardDraft(actor: ReviewActor, id: string) {
  const r = await loadReview(actor.businessId, id);
  const updated = await db.gbpReview.update({
    where: { id: r.id },
    data: { draftReply: null, draftedById: null, draftedByName: null, replyError: null, replyStatus: r.replyText ? "posted" : "none" },
    include: { location: { select: { title: true } } },
  });
  return { review: publicReview(updated) };
}

// ─── Settings ────────────────────────────────────────────────────────

export const reviewSettingsSchema = z.object({ autoReplyNoText: z.boolean() });

export async function saveReviewSettings(actor: ReviewActor, input: z.infer<typeof reviewSettingsSchema>) {
  await db.seoSettings.upsert({ where: { businessId: actor.businessId }, create: { businessId: actor.businessId, ...input }, update: input });
  await log(actor, "update", `${input.autoReplyNoText ? "Turned on" : "Turned off"} automatic thank-you replies to 4-5 star reviews without text`);
  return input;
}
