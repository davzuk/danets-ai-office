import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/documents/[id] — single document with chunks + recent questions
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      chunks: { orderBy: { chunkIndex: "asc" } },
      questions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      category: doc.category,
      sourceType: doc.sourceType,
      content: doc.content,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      summary: doc.summary,
      status: doc.status,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      chunks: doc.chunks.map((c) => ({
        id: c.id,
        content: c.content,
        chunkIndex: c.chunkIndex,
      })),
      questions: doc.questions.map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        createdAt: q.createdAt.toISOString(),
      })),
    },
  });
}

const patchSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  category: z.string().max(60).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

// PATCH /api/documents/[id] — update metadata
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: any = {};
  if (parsed.data.title) data.title = parsed.data.title.trim();
  if (parsed.data.category) data.category = parsed.data.category;
  if (parsed.data.status) data.status = parsed.data.status;

  const updated = await db.document.update({ where: { id }, data });
  return NextResponse.json({ document: updated });
}

// DELETE /api/documents/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.document.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
