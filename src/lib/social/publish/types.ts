export interface PublishMedia {
  kind: "image" | "video" | string;
  url: string;
  mimeType: string;
  altText: string | null;
}

export interface PublishInput {
  /** Page id (Facebook) or Instagram business account id. */
  externalId: string;
  /** Final post text, hashtags included. */
  text: string;
  linkUrl: string | null;
  media: PublishMedia[];
  /** Instagram container from an earlier attempt, reused instead of re-uploading. */
  containerId?: string | null;
}

export interface PublishResult {
  externalPostId: string;
  permalink: string | null;
}

export interface PublishHooks {
  /** Persist an Instagram container id as soon as it exists, so a retry can reuse it. */
  onContainer?: (id: string | null) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for Instagram to process media before handing back to the queue. */
  maxWaitMs?: number;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
