import { NextRequest, NextResponse } from "next/server";
import { getStorage, isSafeKey, readLocalFile } from "@/lib/storage";

// GET /api/media/files/<key>: public file serving for STORAGE_DRIVER=local.
// Public on purpose: Instagram and LinkedIn fetch post media by URL without
// cookies. Keys carry 96 random bits, so they can't be guessed. With the s3
// driver files are served by the bucket and this route returns 404.

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const notFound = () => new NextResponse("Not found", { status: 404 });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  if (getStorage().name !== "local") return notFound();
  const key = (await params).key.join("/");
  const type = TYPES[key.split(".").pop() ?? ""];
  if (!type || !isSafeKey(key)) return notFound();
  const file = await readLocalFile(key);
  if (!file) return notFound();
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(file.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
