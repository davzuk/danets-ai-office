import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf(". ");
      const lastNewline = chunk.lastIndexOf("\n");
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > chunkSize * 0.5) {
        chunk = text.slice(start, start + breakPoint + 1);
        start = start + breakPoint + 1 - overlap;
      } else {
        start = end - overlap;
      }
    } else {
      start = end;
    }

    chunks.push(chunk.trim());
    if (chunks.length >= 50) break;
  }

  return chunks.filter((c) => c.length > 0);
}

async function extractText(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ content: string; sourceType: "pdf" | "docx" | "txt" }> {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  if (mimeType === "application/pdf" || ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const content = (result.text || "").trim();
      if (!content) throw new Error("Could not extract text from PDF");
      return { content, sourceType: "pdf" };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const content = (result.value || "").trim();
    if (!content) throw new Error("Could not extract text from DOCX");
    return { content, sourceType: "docx" };
  }

  if (mimeType === "text/plain" || ext === "txt") {
    const content = buffer.toString("utf-8").trim();
    if (!content) throw new Error("Text file is empty");
    return { content, sourceType: "txt" };
  }

  throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT.");
}

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const uploadEnabled = await isFeatureEnabled(user.businessId, "document_upload");
    if (!uploadEnabled) {
      throw new Error("Document upload is not enabled for your account. Contact support.");
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) throw new Error("Invalid form data");

    const file = formData.get("file");
    const titleRaw = String(formData.get("title") || "").trim();
    const category = String(formData.get("category") || "General").trim() || "General";

    if (!(file instanceof File)) throw new Error("No file provided");
    if (file.size > MAX_FILE_SIZE) throw new Error("File too large (max 10 MB)");
    if (!ALLOWED_TYPES.has(file.type) && !/\.(pdf|docx|txt)$/i.test(file.name)) {
      throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT.");
    }

    const title = titleRaw || file.name.replace(/\.[^.]+$/, "") || "Untitled";
    if (title.length < 2) throw new Error("Title must be at least 2 characters");

    const buffer = Buffer.from(await file.arrayBuffer());
    const { content, sourceType } = await extractText(buffer, file.name, file.type);

    const document = await db.document.create({
      data: {
        businessId: user.businessId,
        title: title.slice(0, 200),
        content,
        category: category.slice(0, 60),
        sourceType,
        fileName: file.name,
        fileSize: file.size,
        status: "active",
      },
    });

    const chunks = splitIntoChunks(content, 500, 100);
    if (chunks.length > 0) {
      await db.documentChunk.createMany({
        data: chunks.map((chunkContent, index) => ({
          documentId: document.id,
          content: chunkContent,
          chunkIndex: index,
        })),
      });
    }

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "document_uploaded",
      module: "documents",
      description: `Uploaded file "${title}" (${chunks.length} chunks)`,
      metadata: { documentId: document.id, fileName: file.name },
    });

    return {
      document: {
        id: document.id,
        title: document.title,
        category: document.category,
        sourceType: document.sourceType,
        fileName: document.fileName,
        fileSize: document.fileSize,
        contentLength: content.length,
        chunkCount: chunks.length,
        createdAt: document.createdAt.toISOString(),
      },
    };
  });
}
