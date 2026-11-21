import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { LimitExceededError, formatLimitExceededMessage } from "@/lib/plan-quota";
import { MediaUploadError, mediaStorageUsage, saveMedia, toPublicMedia, type PublicMedia } from "@/lib/media";

const PAGE_SIZE = 40;
const MAX_FILES_PER_REQUEST = 10;
const MB = 1024 * 1024;

// GET /api/media?kind=image|video&cursor=<id>: the tenant's library, newest first, plus storage usage
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const kind = req.nextUrl.searchParams.get("kind");
    const cursor = req.nextUrl.searchParams.get("cursor");
    const [rows, usage] = await Promise.all([
      db.mediaAsset.findMany({
        where: { businessId: user.businessId, ...(kind === "image" || kind === "video" ? { kind } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      mediaStorageUsage(user.businessId),
    ]);
    const page = rows.slice(0, PAGE_SIZE);
    return {
      items: page.map(toPublicMedia),
      nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
      usage: { usedMb: Math.round((usage.usedBytes / MB) * 10) / 10, limitMb: usage.limitMb },
    };
  });
}

// POST /api/media (multipart): one or more "file" parts, optional "altText" (applied when one file is sent)
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("Send the files as multipart/form-data.", { status: 400, code: "INVALID_BODY" });
    }
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    if (files.length === 0) throw new AppError("No file was attached.", { status: 400, code: "NO_FILE" });
    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new AppError(`Upload up to ${MAX_FILES_PER_REQUEST} files at a time.`, { status: 400, code: "TOO_MANY_FILES" });
    }
    const altText = files.length === 1 ? String(form.get("altText") ?? "") : null;

    const items: PublicMedia[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const file of files) {
      try {
        const asset = await saveMedia({
          businessId: user.businessId,
          userId: user.userId,
          buffer: Buffer.from(await file.arrayBuffer()),
          originalName: file.name,
          altText,
        });
        items.push(toPublicMedia(asset));
      } catch (e) {
        if (e instanceof MediaUploadError) errors.push({ name: file.name, error: e.message });
        else if (e instanceof LimitExceededError) errors.push({ name: file.name, error: formatLimitExceededMessage(e) });
        else throw e;
      }
    }
    // Every file rejected: report it as a failed request so the client shows the reason.
    if (items.length === 0) {
      throw new AppError(errors[0]?.error ?? "Upload failed.", { status: 400, code: "UPLOAD_REJECTED" });
    }
    return { items, errors };
  });
}
