// LinkedIn Page publishing (Posts API, versioned REST).
//   text (+ link)   POST /rest/posts, link as an article card
//   images          POST /rest/images?action=initializeUpload, PUT the bytes, then
//                   content.media (one) or content.multiImage (2-20)
//   one video       POST /rest/videos?action=initializeUpload, PUT each part,
//                   finalizeUpload with the parts' ETags, wait until AVAILABLE
// Unlike Meta, LinkedIn takes the file bytes, so media doesn't need a public URL.

import { LINKEDIN_REST, linkedinHeaders, orgUrn } from "@/lib/connections/providers/linkedin";
import type { Env } from "@/lib/connections/types";
import { PublishError, type FetchLike, type PublishErrorKind } from "./meta-http";
import { sleep as defaultSleep, type PublishHooks, type PublishMedia, type PublishResult } from "./types";

export const LINKEDIN_MAX_IMAGES = 20;

/** Sort a LinkedIn error response into what the publish job should do. */
export function classifyLinkedInError(status: number, body: unknown): PublishError {
  const b = body as { message?: string; serviceErrorCode?: number; code?: string } | null;
  const message = b?.message || `HTTP ${status}`;
  let kind: PublishErrorKind;
  if (status === 401) kind = "auth";
  else if (status === 403) kind = /ACCESS_DENIED|permission|not enough permissions|scope/i.test(message) || b?.code === "ACCESS_DENIED" ? "auth" : "content";
  else if (status === 429 || status >= 500) kind = "retry";
  else kind = "content";
  return new PublishError(message, kind, b?.serviceErrorCode, undefined);
}

export interface LinkedInClient {
  json<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ data: T; headers: Headers }>;
  upload(url: string, bytes: Uint8Array, contentType: string): Promise<Headers>;
}

export function linkedinClient(token: string, env: Env = process.env, fetchImpl: FetchLike = fetch): LinkedInClient {
  async function send(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new PublishError(`Network error: ${(e as Error).message}`, "retry");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON
      }
      throw classifyLinkedInError(res.status, json ?? { message: text.slice(0, 200) || undefined });
    }
    return res;
  }
  return {
    async json<T>(method: "GET" | "POST", path: string, body?: unknown) {
      const res = await send(`${LINKEDIN_REST}${path}`, {
        method,
        headers: linkedinHeaders(env, token, body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return { data: (text ? JSON.parse(text) : {}) as T, headers: res.headers };
    },
    async upload(url, bytes, contentType) {
      const res = await send(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
        body: bytes as unknown as BodyInit,
      });
      return res.headers;
    },
  };
}

// ─── Text ──────────────────────────────────────────────────────────────

const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

/**
 * Post commentary uses LinkedIn's "little text" format: reserved characters
 * must be escaped, and hashtags are written as {hashtag|\#|tag} templates.
 */
export function toLittleText(text: string): string {
  return text
    .split(/(#[\p{L}\p{N}_]+)/u)
    .map((part) => (/^#[\p{L}\p{N}_]+$/u.test(part) ? `{hashtag|\\#|${part.slice(1)}}` : part.replace(RESERVED, (c) => `\\${c}`)))
    .join("");
}

export const linkedinPermalink = (urn: string) => `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;

// ─── Media ─────────────────────────────────────────────────────────────

export interface LinkedInPublishInput {
  /** Organization id or URN. */
  externalId: string;
  text: string;
  linkUrl: string | null;
  /** Shown on the link card (LinkedIn requires a title). */
  linkTitle: string;
  media: PublishMedia[];
  /** Reads a media file's bytes (local disk or object storage). */
  readMedia: (m: PublishMedia) => Promise<Uint8Array>;
}

async function uploadImage(client: LinkedInClient, owner: string, m: PublishMedia, read: LinkedInPublishInput["readMedia"]) {
  const init = await client.json<{ value: { uploadUrl: string; image: string } }>("POST", "/images?action=initializeUpload", {
    initializeUploadRequest: { owner },
  });
  await client.upload(init.data.value.uploadUrl, await read(m), m.mimeType);
  return init.data.value.image;
}

async function uploadVideo(client: LinkedInClient, owner: string, m: PublishMedia, read: LinkedInPublishInput["readMedia"], hooks: PublishHooks) {
  const bytes = await read(m);
  const init = await client.json<{
    value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
  }>("POST", "/videos?action=initializeUpload", {
    initializeUploadRequest: { owner, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false },
  });
  const { video, uploadToken, uploadInstructions } = init.data.value;
  const etags: string[] = [];
  for (const part of uploadInstructions) {
    const h = await client.upload(part.uploadUrl, bytes.subarray(part.firstByte, part.lastByte + 1), "application/octet-stream");
    const etag = h.get("etag");
    if (!etag) throw new PublishError("LinkedIn didn't confirm a video part upload.", "retry");
    etags.push(etag);
  }
  await client.json("POST", "/videos?action=finalizeUpload", {
    finalizeUploadRequest: { video, uploadToken: uploadToken ?? "", uploadedPartIds: etags },
  });

  // Posting a video before LinkedIn has processed it fails, so wait.
  const sleep = hooks.sleep ?? defaultSleep;
  const deadline = Date.now() + (hooks.maxWaitMs ?? 120_000);
  let delay = 3_000;
  for (;;) {
    const r = await client.json<{ status?: string }>("GET", `/videos/${encodeURIComponent(video)}`);
    if (r.data.status === "AVAILABLE") return video;
    if (r.data.status === "PROCESSING_FAILED") throw new PublishError("LinkedIn couldn't process the video.", "content");
    if (Date.now() + delay > deadline) throw new PublishError("LinkedIn is still processing the video; trying again shortly.", "retry");
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
}

export async function publishToLinkedIn(client: LinkedInClient, input: LinkedInPublishInput, hooks: PublishHooks = {}): Promise<PublishResult> {
  const author = orgUrn(input.externalId);
  const videos = input.media.filter((m) => m.kind === "video");
  const images = input.media.filter((m) => m.kind === "image");
  if (videos.length > 0 && (videos.length > 1 || images.length > 0)) {
    throw new PublishError("LinkedIn posts can have several images or one video, not both.", "content");
  }
  if (images.length > LINKEDIN_MAX_IMAGES) throw new PublishError(`LinkedIn posts take up to ${LINKEDIN_MAX_IMAGES} images.`, "content");

  // Media posts can't also carry a link card; keep the link in the text instead.
  const text = input.media.length && input.linkUrl && !input.text.includes(input.linkUrl) ? `${input.text}\n\n${input.linkUrl}` : input.text;

  let content: Record<string, unknown> | undefined;
  if (videos.length === 1) {
    content = { media: { id: await uploadVideo(client, author, videos[0], input.readMedia, hooks) } };
  } else if (images.length === 1) {
    const id = await uploadImage(client, author, images[0], input.readMedia);
    content = { media: { id, ...(images[0].altText ? { altText: images[0].altText.slice(0, 4086) } : {}) } };
  } else if (images.length > 1) {
    const ids: { id: string; altText?: string }[] = [];
    for (const img of images) {
      ids.push({ id: await uploadImage(client, author, img, input.readMedia), ...(img.altText ? { altText: img.altText.slice(0, 4086) } : {}) });
    }
    content = { multiImage: { images: ids } };
  } else if (input.linkUrl) {
    content = { article: { source: input.linkUrl, title: input.linkTitle.slice(0, 400) || input.linkUrl } };
  }

  const res = await client.json<{ id?: string }>("POST", "/posts", {
    author,
    commentary: toLittleText(text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
    ...(content ? { content } : {}),
  });
  const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || res.data.id;
  if (!urn) throw new PublishError("LinkedIn accepted the post but didn't return its id.", "content");
  return { externalPostId: urn, permalink: linkedinPermalink(urn) };
}
