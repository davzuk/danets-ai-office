// Instagram publishing (Content Publishing API).
//   1. check the 24-hour publishing limit (25 posts)
//   2. create a media container: image, Reel, or carousel (children first)
//   3. wait until the container's status_code is FINISHED
//   4. POST /{ig-id}/media_publish with creation_id
// Media must be at a public URL; images must be JPEG (the caller converts).

import { PublishError, type GraphClient } from "./meta-http";
import { sleep as defaultSleep, type PublishHooks, type PublishInput, type PublishMedia, type PublishResult } from "./types";

export const IG_MAX_CAROUSEL = 10;

type ContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED";

async function containerStatus(client: GraphClient, id: string) {
  const r = await client.get<{ status_code?: ContainerStatus; status?: string }>(`/${encodeURIComponent(id)}`, {
    fields: "status_code,status",
  });
  return { code: r.status_code ?? "IN_PROGRESS", detail: r.status ?? "" };
}

/** Wait for a container; returns false if it's still processing when the budget runs out. */
async function waitFinished(client: GraphClient, id: string, hooks: PublishHooks): Promise<boolean> {
  const sleep = hooks.sleep ?? defaultSleep;
  const deadline = Date.now() + (hooks.maxWaitMs ?? 90_000);
  let delay = 2_000;
  for (;;) {
    const { code, detail } = await containerStatus(client, id);
    if (code === "FINISHED" || code === "PUBLISHED") return true;
    if (code === "ERROR") throw new PublishError(`Instagram couldn't process the media${detail ? `: ${detail}` : ""}.`, "content");
    if (code === "EXPIRED") throw new PublishError("The Instagram upload expired before it was published.", "retry");
    if (Date.now() + delay > deadline) return false;
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
}

function mediaParams(m: PublishMedia, child: boolean): Record<string, string> {
  if (m.kind === "video") {
    return { media_type: child ? "VIDEO" : "REELS", video_url: m.url, ...(child ? { is_carousel_item: "true" } : {}) };
  }
  return {
    image_url: m.url,
    ...(child ? { is_carousel_item: "true" } : {}),
    ...(m.altText ? { alt_text: m.altText } : {}),
  };
}

async function createContainer(client: GraphClient, input: PublishInput, hooks: PublishHooks): Promise<string> {
  const ig = `/${encodeURIComponent(input.externalId)}`;
  if (input.media.length === 1) {
    const r = await client.post<{ id: string }>(`${ig}/media`, { ...mediaParams(input.media[0], false), caption: input.text });
    return r.id;
  }
  const children: string[] = [];
  for (const m of input.media) {
    const r = await client.post<{ id: string }>(`${ig}/media`, mediaParams(m, true));
    children.push(r.id);
  }
  for (const c of children) {
    if (!(await waitFinished(client, c, hooks))) {
      throw new PublishError("Instagram is still processing the carousel media; trying again shortly.", "retry");
    }
  }
  const r = await client.post<{ id: string }>(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: input.text });
  return r.id;
}

export async function publishToInstagram(client: GraphClient, input: PublishInput, hooks: PublishHooks = {}): Promise<PublishResult> {
  if (input.media.length === 0) throw new PublishError("Instagram posts need at least one image or video.", "content");
  if (input.media.length > IG_MAX_CAROUSEL) throw new PublishError(`Instagram carousels take up to ${IG_MAX_CAROUSEL} items.`, "content");
  const ig = `/${encodeURIComponent(input.externalId)}`;

  let containerId = input.containerId ?? null;
  if (!containerId) {
    const limit = await client
      .get<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(`${ig}/content_publishing_limit`, {
        fields: "quota_usage,config",
      })
      .catch(() => null);
    const usage = limit?.data?.[0];
    if (usage && usage.quota_usage !== undefined && usage.quota_usage >= (usage.config?.quota_total ?? 25)) {
      throw new PublishError("This Instagram account has hit its 24-hour publishing limit; it will be retried later.", "retry");
    }
    containerId = await createContainer(client, input, hooks);
    await hooks.onContainer?.(containerId);
  }

  try {
    if (!(await waitFinished(client, containerId, hooks))) {
      throw new PublishError("Instagram is still processing the media; trying again shortly.", "retry");
    }
  } catch (e) {
    // An expired or failed container can't be reused.
    if (e instanceof PublishError && /expired|couldn't process/.test(e.message)) await hooks.onContainer?.(null);
    throw e;
  }

  const published = await client.post<{ id: string }>(`${ig}/media_publish`, { creation_id: containerId });
  let permalink: string | null = null;
  try {
    permalink = (await client.get<{ permalink?: string }>(`/${encodeURIComponent(published.id)}`, { fields: "permalink" })).permalink ?? null;
  } catch {
    // published; the link is a nice-to-have
  }
  return { externalPostId: published.id, permalink };
}
