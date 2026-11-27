import type { ContentPost, PostVariant, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { getBrandProfileRow, toInput } from "@/lib/brand";
import { CONTENT_LIMITS, type GeneratedVariant } from "./generate";
import {
  CONTENT_GOALS,
  CONTENT_PLATFORMS,
  PLATFORM_RULES,
  checkVariant,
  hasErrors,
  normalizeHashtags,
  type ContentPlatform,
  type VariantIssue,
} from "./platforms";

export const POST_STATUSES = ["draft", "in_review", "approved", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(u), "Enter a full link starting with https://");

export const createPostSchema = z.object({
  brief: z.string().trim().min(10, "Describe the post in a sentence or two.").max(CONTENT_LIMITS.brief),
  platforms: z.array(z.enum(CONTENT_PLATFORMS)).min(1, "Pick at least one platform.").max(CONTENT_PLATFORMS.length),
  goal: z.enum(CONTENT_GOALS).nullish(),
  toneTweak: z.string().trim().max(CONTENT_LIMITS.toneTweak).nullish(),
  linkUrl: httpUrl.nullish().or(z.literal("")),
  campaignTag: z.string().trim().max(80).nullish(),
  sourceType: z.enum(["kb_article", "lead_question"]).nullish(),
  sourceId: z.string().max(64).nullish(),
});

export const updatePostSchema = z.object({
  title: z.string().trim().max(120).nullish(),
  brief: z.string().trim().min(10).max(CONTENT_LIMITS.brief).optional(),
  goal: z.enum(CONTENT_GOALS).nullish(),
  toneTweak: z.string().trim().max(CONTENT_LIMITS.toneTweak).nullish(),
  campaignTag: z.string().trim().max(80).nullish(),
  status: z.enum(POST_STATUSES).optional(),
});

export const updateVariantSchema = z.object({
  body: z.string().max(70_000).optional(),
  hashtags: z.array(z.string().max(80)).max(60).optional(),
  mediaIds: z.array(z.string().max(64)).max(10).optional(),
  linkUrl: httpUrl.nullish().or(z.literal("")),
  imagePrompt: z.string().max(2000).nullish(),
});

export const rewriteSchema = z.object({
  action: z.enum(["regenerate", "shorter", "add_cta", "translate", "custom"]),
  locale: z.string().trim().max(40).nullish(),
  instruction: z.string().trim().max(CONTENT_LIMITS.instruction).nullish(),
});

export type PostWithVariants = ContentPost & { variants: PostVariant[] };

const PLATFORM_ORDER = new Map(CONTENT_PLATFORMS.map((p, i) => [p, i]));

export function titleFromBrief(brief: string) {
  const first = brief.trim().split("\n")[0].replace(/\s+/g, " ");
  return first.length > 80 ? first.slice(0, 77).trimEnd() + "…" : first;
}

const asStrings = (v: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export interface PublicVariant {
  id: string;
  platform: ContentPlatform;
  body: string;
  hashtags: string[];
  mediaIds: string[];
  linkUrl: string | null;
  imagePrompt: string | null;
  aiGenerated: boolean;
  editedByHuman: boolean;
  issues: VariantIssue[];
  updatedAt: string;
}

export interface PublicPost {
  id: string;
  title: string;
  brief: string;
  goal: string | null;
  toneTweak: string | null;
  campaignTag: string | null;
  sourceType: string | null;
  status: string;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: PublicVariant[];
}

export function toPublicPost(post: PostWithVariants, dontPhrases: string[]): PublicPost {
  return {
    id: post.id,
    title: post.title || titleFromBrief(post.brief),
    brief: post.brief,
    goal: post.goal,
    toneTweak: post.toneTweak,
    campaignTag: post.campaignTag,
    sourceType: post.sourceType,
    status: post.status,
    createdById: post.createdById,
    approvedById: post.approvedById,
    approvedAt: post.approvedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    variants: post.variants
      .filter((v): v is PostVariant & { platform: ContentPlatform } => PLATFORM_ORDER.has(v.platform as ContentPlatform))
      .sort((a, b) => PLATFORM_ORDER.get(a.platform)! - PLATFORM_ORDER.get(b.platform)!)
      .map((v) => {
        const hashtags = asStrings(v.hashtags);
        return {
          id: v.id,
          platform: v.platform,
          body: v.body,
          hashtags,
          mediaIds: asStrings(v.mediaIds),
          linkUrl: v.linkUrl,
          imagePrompt: v.imagePrompt,
          aiGenerated: v.aiGenerated,
          editedByHuman: v.editedByHuman,
          issues: checkVariant(v.platform, { body: v.body, hashtags, linkUrl: v.linkUrl }, dontPhrases),
          updatedAt: v.updatedAt.toISOString(),
        };
      }),
  };
}

export async function getDontPhrases(businessId: string) {
  return toInput(await getBrandProfileRow(businessId))?.dontPhrases ?? [];
}

export async function findOwnPost(businessId: string, id: string): Promise<PostWithVariants> {
  const post = await db.contentPost.findFirst({ where: { id, businessId }, include: { variants: true } });
  if (!post) throw new AppError("Post not found.", { status: 404, code: "NOT_FOUND" });
  return post;
}

export async function loadPublicPost(businessId: string, id: string) {
  const [post, dont] = await Promise.all([findOwnPost(businessId, id), getDontPhrases(businessId)]);
  return toPublicPost(post, dont);
}

/** Store freshly generated copy. Attached media survives a regenerate. */
export async function saveGeneratedVariants(postId: string, variants: GeneratedVariant[]) {
  await db.$transaction(
    variants.map((v) =>
      db.postVariant.upsert({
        where: { postId_platform: { postId, platform: v.platform } },
        create: {
          postId,
          platform: v.platform,
          body: v.body,
          hashtags: v.hashtags,
          linkUrl: v.linkUrl ?? null,
          imagePrompt: v.imagePrompt,
          aiGenerated: true,
          editedByHuman: false,
        },
        update: {
          body: v.body,
          hashtags: v.hashtags,
          linkUrl: v.linkUrl ?? null,
          imagePrompt: v.imagePrompt,
          aiGenerated: true,
          editedByHuman: false,
        },
      })
    )
  );
}

/** Media ids must exist in this tenant's library (and images only where a platform can't take video). */
export async function validateMediaIds(businessId: string, platform: ContentPlatform, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.mediaAsset.findMany({ where: { businessId, id: { in: unique } }, select: { id: true, kind: true } });
  if (rows.length !== unique.length) throw new AppError("Some of the selected media no longer exists.", { status: 400, code: "MEDIA_NOT_FOUND" });
  const videos = rows.filter((r) => r.kind === "video").length;
  if (videos > 0 && unique.length > 1 && platform !== "instagram") {
    throw new AppError(`${PLATFORM_RULES[platform].label} posts can have several images or one video, not both.`, { status: 400, code: "MEDIA_MIX" });
  }
  if (platform === "google_business" && (videos > 0 || unique.length > 1)) {
    throw new AppError("Google Business Profile posts take one photo (no video).", { status: 400, code: "MEDIA_GBP" });
  }
  if (platform === "tiktok" && (videos !== 1 || unique.length !== 1)) {
    throw new AppError("TikTok posts need exactly one video.", { status: 400, code: "MEDIA_TIKTOK" });
  }
  return unique;
}

/** Who may move a post where. Approval is for admins; anyone can draft and request review. */
export function assertTransition(post: Pick<ContentPost, "status">, to: PostStatus, role: string, variants: PublicVariant[]) {
  if (post.status === to) return;
  if (to === "approved") {
    if (role !== "admin") throw new AppError("Only admins can approve posts.", { status: 403, code: "FORBIDDEN" });
  }
  if (to === "in_review" || to === "approved") {
    if (variants.length === 0) throw new AppError("Generate or write at least one platform first.", { status: 400, code: "NO_VARIANTS" });
    const broken = variants.filter((v) => hasErrors(v.issues)).map((v) => PLATFORM_RULES[v.platform].label);
    if (broken.length) {
      throw new AppError(`Fix the problems on ${broken.join(", ")} first.`, { status: 400, code: "VARIANT_ERRORS" });
    }
  }
}

export function variantUpdateData(platform: ContentPlatform, input: z.infer<typeof updateVariantSchema>, mediaIds?: string[]) {
  const data: Prisma.PostVariantUpdateInput = { editedByHuman: true };
  if (input.body !== undefined) data.body = input.body.replace(/\r\n/g, "\n");
  if (input.hashtags !== undefined) data.hashtags = normalizeHashtags(input.hashtags);
  if (mediaIds !== undefined) data.mediaIds = mediaIds;
  if (input.linkUrl !== undefined) data.linkUrl = PLATFORM_RULES[platform].clickableLinks ? input.linkUrl || null : null;
  if (input.imagePrompt !== undefined) data.imagePrompt = input.imagePrompt || null;
  return data;
}

/** Parse a JSON body with a schema; the first problem becomes a 400. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    throw new AppError(issue ? `${field ? field + ": " : ""}${issue.message}` : "Invalid request.", { status: 400, code: "INVALID_BODY" });
  }
  return parsed.data;
}
