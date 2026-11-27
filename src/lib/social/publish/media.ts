// Turn a post's media assets into what a platform can fetch.
// Instagram only accepts JPEG images, so other formats get a JPEG copy
// (stored once, next to the original, and deleted with it).

import type { MediaAsset } from "@prisma/client";
import sharp from "sharp";
import { derivedJpegKey } from "@/lib/media";
import { getStorage, readLocalFile } from "@/lib/storage";
import { PublishError } from "./meta-http";
import type { PublishMedia } from "./types";

/** Instagram feed images must be between 4:5 portrait and 1.91:1 landscape. */
export const IG_MIN_RATIO = 0.8;
export const IG_MAX_RATIO = 1.91;

export function igAspectIssue(m: Pick<MediaAsset, "kind" | "width" | "height">): string | null {
  if (m.kind !== "image" || !m.width || !m.height) return null;
  const r = m.width / m.height;
  if (r < IG_MIN_RATIO - 0.005) return "is taller than 4:5, which Instagram doesn't allow";
  if (r > IG_MAX_RATIO + 0.005) return "is wider than 1.91:1, which Instagram doesn't allow";
  return null;
}

/** A media file's bytes, from local disk or object storage. */
export async function readMediaBytes(asset: MediaAsset): Promise<Buffer> {
  const storage = getStorage();
  if (storage.name === "local") {
    const buf = await readLocalFile(asset.storageKey);
    if (buf) return buf;
    throw new PublishError("The media file is missing from storage.", "content");
  }
  const res = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok) throw new PublishError("Couldn't read the media file from storage.", "retry");
  return Buffer.from(await res.arrayBuffer());
}

async function jpegUrl(asset: MediaAsset): Promise<string> {
  if (asset.mimeType === "image/jpeg") return asset.url;
  const storage = getStorage();
  const key = derivedJpegKey(asset);
  const original = await readMediaBytes(asset);
  const jpeg = await sharp(original, { animated: false })
    .flatten({ background: "#ffffff" }) // transparency would turn black
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  await storage.put(key, jpeg, "image/jpeg");
  return storage.publicUrl(key);
}

export async function mediaForPlatform(platform: string, assets: MediaAsset[]): Promise<PublishMedia[]> {
  const out: PublishMedia[] = [];
  for (const a of assets) {
    // Instagram takes JPEG only; Google Business Profile takes JPEG or PNG.
    const convert = a.kind === "image" && (platform === "instagram" || (platform === "google_business" && a.mimeType !== "image/png"));
    const url = convert ? await jpegUrl(a) : a.url;
    out.push({ kind: a.kind, url, mimeType: convert ? "image/jpeg" : a.mimeType, altText: a.altText });
  }
  return out;
}

/** Local media URLs can't be fetched by Meta; say so instead of letting the Graph API fail vaguely. */
export function unreachableMediaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost") || host.endsWith(".test");
  } catch {
    return true;
  }
}
