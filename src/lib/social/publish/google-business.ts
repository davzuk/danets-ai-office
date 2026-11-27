// Google Business Profile posting: a "What's new" (STANDARD) local post with
// at most one photo and a button for the link.
//   POST mybusiness.googleapis.com/v4/{accounts/*/locations/*}/localPosts

import { OAuthGrantError, OAuthProviderError } from "@/lib/connections/types";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import { createLocalPost, type LocalPostInput } from "@/lib/seo/gbp";
import type { GoogleRef } from "@/lib/seo/google";
import { PublishError } from "./meta-http";
import type { PublishInput, PublishResult } from "./types";

export const GBP_SUMMARY_MAX = 1_500;

/** The local post Google is sent. Pure; exported for tests. */
export function toLocalPost(input: PublishInput, languageCode = "en"): LocalPostInput {
  const videos = input.media.filter((m) => m.kind !== "image");
  if (videos.length) throw new PublishError("Google Business Profile posts can have a photo, not a video.", "content");
  if (input.media.length > 1) throw new PublishError("Google Business Profile posts take one photo.", "content");
  const summary = input.text.trim();
  if (!summary) throw new PublishError("The post is empty.", "content");
  if ([...summary].length > GBP_SUMMARY_MAX) throw new PublishError(`Google Business Profile posts are limited to ${GBP_SUMMARY_MAX} characters.`, "content");
  return {
    summary,
    languageCode,
    linkUrl: input.linkUrl,
    actionType: input.linkUrl && /\/book\//.test(input.linkUrl) ? "BOOK" : "LEARN_MORE",
    imageUrl: input.media[0]?.url ?? null,
  };
}

/** Sort a Google failure into the publish job's retry / auth / content buckets. */
export function publishErrorFrom(e: unknown): PublishError {
  if (e instanceof PublishError) return e;
  if (e instanceof OAuthGrantError || e instanceof ConnectionUnavailableError) return new PublishError(e.message, "auth");
  if (e instanceof OAuthProviderError) {
    if (e.status === 401 || e.status === 403 || e.status === 404) return new PublishError(`Google refused the post: ${e.message}`, "auth", e.status);
    if (e.status === 400) return new PublishError(`Google rejected the post: ${e.message}`, "content", 400);
    return new PublishError(e.message, "retry", e.status);
  }
  return new PublishError((e as Error)?.message || "Unexpected error", "retry");
}

export async function publishToGoogleBusiness(ref: GoogleRef, input: PublishInput, opts: { languageCode?: string; create?: typeof createLocalPost } = {}): Promise<PublishResult> {
  const post = toLocalPost(input, opts.languageCode);
  try {
    const r = await (opts.create ?? createLocalPost)(ref, input.externalId, post);
    return { externalPostId: r.name, permalink: r.searchUrl };
  } catch (e) {
    throw publishErrorFrom(e);
  }
}
