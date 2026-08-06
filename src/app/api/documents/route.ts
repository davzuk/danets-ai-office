import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { requireQuota } from "@/lib/plan-quota";
import { splitIntoChunks } from "@/lib/text-chunker";

// GET /api/documents — list documents for the business
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() || undefined;
    const category = searchParams.get("category") || undefined;

    const where: any = { businessId: user.businessId };
    if (category) where.category = category;
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
      ];
    }

    const documents = await db.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        category: true,
        sourceType: true,
        fileName: true,
        fileSize: true,
        summary: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chunks: true, questions: true } },
      },
    });

    return {
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        sourceType: d.sourceType,
        fileName: d.fileName,
        fileSize: d.fileSize,
        summary: d.summary,
        status: d.status,
        chunkCount: d._count.chunks,
        questionCount: d._count.questions,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  });
}

const createSchema = z.object({
  title: z.string().min(2).max(200),
  content: z.string().min(1).max(100000),
  category: z.string().max(60).default("General"),
  sourceType: z.enum(["text", "pdf", "docx", "txt"]).default("text"),
  fileName: z.string().max(200).optional(),
  fileSize: z.number().optional(),
});

// POST /api/documents — create a document (manual text or extracted from upload)
// Automatically splits content into chunks for RAG retrieval.
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const d = parsed.data;
    const content = d.content.trim();

    await requireQuota(user.businessId, "documents");

    const document = await db.document.create({
      data: {
        businessId: user.businessId,
        title: d.title.trim(),
        content,
        category: d.category,
        sourceType: d.sourceType,
        fileName: d.fileName || null,
        fileSize: d.fileSize || null,
        status: "active",
      },
    });

    // Split content into chunks (~500 chars, overlap 100)
    const chunks = splitIntoChunks(content, 500, 100);
    if (chunks.length > 0) {
      await db.documentChunk.createMany({
        data: chunks.map((content, index) => ({
          documentId: document.id,
          content,
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
      description: `Uploaded document "${d.title.trim()}" (${chunks.length} chunks)`,
      metadata: { documentId: document.id },
    });

    return { document, chunkCount: chunks.length };
  });
}
