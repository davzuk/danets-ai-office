// Media library uploads: type sniffing (magic bytes, never the extension or
// the browser's claimed type), size limits, image re-encoding with sharp
// (strips EXIF/GPS, applies orientation, caps the longest side) and the
// MediaAsset row.

import { randomBytes } from "crypto";
import type { MediaAsset } from "@prisma/client";
import sharp from "sharp";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logger, serializeError } from "@/lib/logger";
import { LimitExceededError, getEffectiveLimits } from "@/lib/plan-quota";
import { getStorage } from "@/lib/storage";

export const MEDIA_LIMITS = {
  imageBytes: 8 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  maxImageSide: 2048,
  altText: 1000,
} as const;

type Sniffed = { mime: string; ext: string; kind: "image" | "video" };

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

/** Detect the real file type from its first bytes. Returns null for anything we don't accept. */
export function sniffMedia(buf: Buffer): Sniffed | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", kind: "image" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "image" };
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif", kind: "image" };
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", kind: "video" };
    // isom, iso2, mp41, mp42, avc1, M4V, dash… are all MP4. HEIC/AVIF images share the box: reject them.
    if (/^(heic|heix|hevc|mif1|msf1|avif)$/.test(brand)) return null;
    return { mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", ext: "webm", kind: "video" };
  return null;
}

export interface ProcessedImage {
  body: Buffer;
  width: number | null;
  height: number | null;
}

/**
 * Re-encode an image in its own format. sharp drops all metadata (EXIF,
 * GPS, XMP) unless asked to keep it; `rotate()` first bakes the EXIF
 * orientation into the pixels so photos don't end up sideways.
 */
export async function processImage(buf: Buffer, mime: string): Promise<ProcessedImage> {
  const animated = mime === "image/gif" || mime === "image/webp";
  let img = sharp(buf, { animated, failOn: "error" })
    .rotate()
    .resize({ width: MEDIA_LIMITS.maxImageSide, height: MEDIA_LIMITS.maxImageSide, fit: "inside", withoutEnlargement: true });
  img =
    mime === "image/jpeg"
      ? img.jpeg({ quality: 85, mozjpeg: true })
      : mime === "image/png"
        ? img.png({ compressionLevel: 9 })
        : mime === "image/webp"
          ? img.webp({ quality: 85 })
          : img.gif();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  // For animations sharp reports the stacked height; pageHeight is one frame.
  const height = (info as { pageHeight?: number }).pageHeight ?? info.height;
  return { body: data, width: info.width ?? null, height: height ?? null };
}

export class MediaUploadError extends AppError {
  constructor(message: string, code = "INVALID_MEDIA") {
    super(message, { status: 400, code });
  }
}

export interface UploadInput {
  businessId: string;
  userId?: string | null;
  buffer: Buffer;
  originalName?: string | null;
  altText?: string | null;
  source?: "upload" | "ai_generated" | "stock";
}

function storageKey(businessId: string, ext: string, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${businessId}/${y}/${m}/${randomBytes(12).toString("hex")}.${ext}`;
}

const MB = 1024 * 1024;

/** Bytes stored and the plan limit (0 = unlimited). Not memoised: uploads in one request must see each other. */
export async function mediaStorageUsage(businessId: string) {
  const [limits, agg] = await Promise.all([
    getEffectiveLimits(businessId),
    db.mediaAsset.aggregate({ where: { businessId }, _sum: { sizeBytes: true } }),
  ]);
  return { usedBytes: agg._sum.sizeBytes ?? 0, limitMb: limits.mediaStorageMbLimit };
}

async function requireMediaStorage(businessId: string, addBytes: number) {
  const { usedBytes, limitMb } = await mediaStorageUsage(businessId);
  if (limitMb > 0 && usedBytes + addBytes > limitMb * MB) {
    throw new LimitExceededError("mediaStorageMb", limitMb, Math.ceil(usedBytes / MB));
  }
}

/** Validate, process, store and index one file. */
export async function saveMedia(input: UploadInput): Promise<MediaAsset> {
  const sniffed = sniffMedia(input.buffer);
  if (!sniffed) throw new MediaUploadError("Unsupported file. Upload a JPEG, PNG, WebP or GIF image, or an MP4, MOV or WebM video.");

  const max = sniffed.kind === "image" ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes;
  if (input.buffer.length > max) {
    throw new MediaUploadError(`${sniffed.kind === "image" ? "Images" : "Videos"} can be up to ${max / (1024 * 1024)} MB.`, "MEDIA_TOO_LARGE");
  }

  let body = input.buffer;
  let width: number | null = null;
  let height: number | null = null;
  if (sniffed.kind === "image") {
    try {
      ({ body, width, height } = await processImage(input.buffer, sniffed.mime));
    } catch (e) {
      logger.warn("Image processing failed", serializeError(e));
      throw new MediaUploadError("That image is damaged or couldn't be read.");
    }
  }

  await requireMediaStorage(input.businessId, body.length);

  const storage = getStorage();
  const key = storageKey(input.businessId, sniffed.ext);
  await storage.put(key, body, sniffed.mime);
  try {
    return await db.mediaAsset.create({
      data: {
        businessId: input.businessId,
        kind: sniffed.kind,
        storageKey: key,
        url: storage.publicUrl(key),
        mimeType: sniffed.mime,
        sizeBytes: body.length,
        width,
        height,
        altText: input.altText?.trim().slice(0, MEDIA_LIMITS.altText) || null,
        originalName: input.originalName?.slice(0, 191) || null,
        source: input.source ?? "upload",
        createdById: input.userId ?? null,
      },
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

/** Remove the file, then the row. A missing file doesn't block deleting the row. */
export async function deleteMedia(row: Pick<MediaAsset, "id" | "storageKey">) {
  try {
    await getStorage().delete(row.storageKey);
  } catch (e) {
    logger.warn("Media file delete failed; removing the record anyway", { mediaId: row.id, ...serializeError(e) });
  }
  await db.mediaAsset.delete({ where: { id: row.id } });
}

/** Delete every file a business stored (GDPR erasure / workspace deletion). Rows go with the cascade. */
export async function purgeBusinessMedia(businessId: string): Promise<number> {
  const storage = getStorage();
  let removed = 0;
  let afterId: string | undefined;
  for (;;) {
    const rows = await db.mediaAsset.findMany({
      where: { businessId, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: 200,
      select: { id: true, storageKey: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      await storage.delete(r.storageKey).catch((e) => logger.warn("Media purge: file delete failed", { mediaId: r.id, ...serializeError(e) }));
      removed++;
    }
    afterId = rows[rows.length - 1].id;
  }
  return removed;
}

export interface PublicMedia {
  id: string;
  kind: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  originalName: string | null;
  source: string;
  createdById: string | null;
  createdAt: string;
}

export function toPublicMedia(m: MediaAsset): PublicMedia {
  return {
    id: m.id,
    kind: m.kind,
    url: m.url,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    width: m.width,
    height: m.height,
    altText: m.altText,
    originalName: m.originalName,
    source: m.source,
    createdById: m.createdById,
    createdAt: m.createdAt.toISOString(),
  };
}
