// Facebook Page publishing.
//   text (+ link)      POST /{page}/feed
//   one photo          POST /{page}/photos   (caption = text)
//   several photos     POST /{page}/photos published=false for each, then /feed with attached_media
//   one video          POST /{page}/videos   (description = text)

import { PublishError, type GraphClient } from "./meta-http";
import type { PublishInput, PublishResult } from "./types";

async function permalinkOf(client: GraphClient, id: string): Promise<string | null> {
  try {
    const r = await client.get<{ permalink_url?: string }>(`/${encodeURIComponent(id)}`, { fields: "permalink_url" });
    const url = r.permalink_url ?? null;
    return url && url.startsWith("/") ? `https://www.facebook.com${url}` : url;
  } catch {
    return null; // the post is up; a missing link isn't worth failing over
  }
}

export async function publishToFacebook(client: GraphClient, input: PublishInput): Promise<PublishResult> {
  const page = `/${encodeURIComponent(input.externalId)}`;
  const videos = input.media.filter((m) => m.kind === "video");
  const images = input.media.filter((m) => m.kind === "image");
  // Photo and video posts can't carry a link preview; keep the link in the text.
  const textWithLink = input.linkUrl && !input.text.includes(input.linkUrl) ? `${input.text}\n\n${input.linkUrl}` : input.text;

  if (videos.length > 0) {
    if (videos.length > 1 || images.length > 0) {
      throw new PublishError("Facebook posts can have several photos or one video, not both.", "content");
    }
    const r = await client.post<{ id: string }>(`${page}/videos`, { file_url: videos[0].url, description: textWithLink });
    return { externalPostId: r.id, permalink: await permalinkOf(client, r.id) };
  }

  if (images.length === 1) {
    const r = await client.post<{ id: string; post_id?: string }>(`${page}/photos`, {
      url: images[0].url,
      caption: textWithLink,
      ...(images[0].altText ? { alt_text_custom: images[0].altText } : {}),
    });
    const id = r.post_id ?? r.id;
    return { externalPostId: id, permalink: await permalinkOf(client, id) };
  }

  if (images.length > 1) {
    const ids: string[] = [];
    for (const img of images) {
      const r = await client.post<{ id: string }>(`${page}/photos`, {
        url: img.url,
        published: "false",
        ...(img.altText ? { alt_text_custom: img.altText } : {}),
      });
      ids.push(r.id);
    }
    const params: Record<string, string> = { message: textWithLink };
    ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    const r = await client.post<{ id: string }>(`${page}/feed`, params);
    return { externalPostId: r.id, permalink: await permalinkOf(client, r.id) };
  }

  const r = await client.post<{ id: string }>(`${page}/feed`, {
    message: input.text,
    ...(input.linkUrl ? { link: input.linkUrl } : {}),
  });
  return { externalPostId: r.id, permalink: await permalinkOf(client, r.id) };
}
