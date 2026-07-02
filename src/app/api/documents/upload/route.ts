import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

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
      if (breakPoint > chunkSize * 0.5) { chunk = text.slice(start, start + breakPoint + 1); start = start + breakPoint + 1 - overlap; }
      else start = end - overlap;
    } else start = end;
    chunks.push(chunk.trim());
    if (chunks.length >= 50) break;
  }
  return chunks.filter((c) => c.length > 0);
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "File too large. Max 10MB." }, { status: 413 });

  const title = (formData.get("title") as string) || file.name.replace(/\.[^.]+$/, "");
  const category = (formData.get("category") as string) || "General";
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  let extractedText = "";
  let sourceType = "text";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (ext === "pdf") {
      sourceType = "pdf";
      const { PDFParse } = await import("pdf-parse");
      const pdf = new PDFParse(new Uint8Array(buffer), { verbosity: 0, useWorker: false });
      await pdf.load();
      extractedText = (await pdf.getText() || "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
    } else if (ext === "docx") {
      sourceType = "docx";
      const mammoth = await import("mammoth");
      extractedText = ((await mammoth.extractRawText({ buffer })).value || "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
    } else if (ext === "txt") {
      sourceType = "txt";
      extractedText = buffer.toString("utf-8").replace(/\r\n/g, "\n").trim();
    } else {
      return NextResponse.json({ error: `Unsupported file type: .${ext}. Supported: PDF, DOCX, TXT.` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to extract text: ${e?.message || "Unknown error"}` }, { status: 500 });
  }

  if (!extractedText || extractedText.trim().length < 10) return NextResponse.json({ error: "No readable text found." }, { status: 422 });
  if (extractedText.length > 100000) extractedText = extractedText.slice(0, 100000) + "\n\n[Truncated at 100,000 characters]";

  const document = await db.document.create({ data: { businessId: user.businessId, title: title.trim(), content: extractedText, category, sourceType, fileName: file.name, fileSize: file.size, status: "active" } });
  const chunks = splitIntoChunks(extractedText, 500, 100);
  if (chunks.length > 0) await db.documentChunk.createMany({ data: chunks.map((content, index) => ({ documentId: document.id, content, chunkIndex: index })) });

  await logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "document_uploaded", module: "documents", description: `Uploaded "${title.trim()}" (${sourceType}, ${chunks.length} chunks)`, metadata: { documentId: document.id } });

  return NextResponse.json({ document: { id: document.id, title: document.title, sourceType, fileName: file.name, contentLength: extractedText.length, chunkCount: chunks.length }, message: `Extracted ${extractedText.length.toLocaleString()} characters, ${chunks.length} chunks.` });
}
