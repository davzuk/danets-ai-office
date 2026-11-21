import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiChat, logUsage, EMPTY_USAGE, type UsageInput } from "@/lib/ai";
import { checkMonthlyAiQuota, quotaExceededResponse } from "@/lib/plan-limits";

const askSchema = z.object({
  question: z.string().min(2).max(1000),
});

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/documents/[id]/ask — ask a question about a document using RAG
// Retrieves relevant chunks via TF-IDF, builds a grounded prompt, calls AI.
// The AI must answer ONLY based on the document content.
export async function POST(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, businessId: user.businessId },
    include: { chunks: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { question } = parsed.data;

  const quota = await checkMonthlyAiQuota(user.businessId);
  if (!quota.allowed) return quotaExceededResponse();

  // Save the question first
  const questionRecord = await db.documentAiQuestion.create({
    data: {
      documentId: id,
      businessId: user.businessId,
      question,
    },
  });

  // Retrieve relevant chunks using simple TF-IDF scoring
  const relevantChunks = retrieveChunks(
    doc.chunks.map((c) => ({ id: c.id, content: c.content })),
    question,
    3
  );

  if (relevantChunks.length === 0) {
    const fallbackAnswer =
      "I could not find enough information in the selected document to answer that confidently.";
    await db.documentAiQuestion.update({
      where: { id: questionRecord.id },
      data: { answer: fallbackAnswer },
    });
    return NextResponse.json({
      answer: fallbackAnswer,
      chunksUsed: 0,
      questionId: questionRecord.id,
    });
  }

  // Build the RAG prompt
  const context = relevantChunks
    .map((c, i) => `### Section ${i + 1}\n${c.content}`)
    .join("\n\n");

  const systemPrompt = `You are a document assistant. Answer the user's question using ONLY the document sections provided below.

CRITICAL RULES:
1. Answer based ONLY on the provided document sections. Do NOT use outside knowledge.
2. If the answer is not contained in the document sections, reply EXACTLY: "I could not find enough information in the selected document to answer that confidently."
3. Do NOT invent information, prices, policies, or dates.
4. Be concise and cite which section the answer comes from when helpful.
5. If the question is ambiguous, ask for clarification.

DOCUMENT: ${doc.title}

DOCUMENT SECTIONS:
${context}`;

  let answer = "";
  let tokens: UsageInput = EMPTY_USAGE;

  try {
    const result = await aiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      { businessId: user.businessId, task: "chat", temperature: 0.3 }
    );
    answer = result.content;
    tokens = result;
  } catch (e: any) {
    answer =
      "I could not process your question right now. Please try again in a moment.";
    await logUsage(
      user.businessId,
      "summary",
      EMPTY_USAGE,
      "error",
      e?.message
    );
  }

  // Update the question record with the answer
  await db.documentAiQuestion.update({
    where: { id: questionRecord.id },
    data: { answer, tokensUsed: tokens.totalTokens },
  });

  // Log usage
  await logUsage(user.businessId, "summary", tokens, "success");

  return NextResponse.json({
    answer,
    chunksUsed: relevantChunks.length,
    chunkPreview: relevantChunks.map((c) => c.content.slice(0, 150) + "..."),
    questionId: questionRecord.id,
    tokens: tokens.totalTokens,
  });
}

// Simple TF-IDF chunk retrieval (same algorithm as KB retrieval)
function retrieveChunks(
  chunks: { id: string; content: string }[],
  query: string,
  topK: number
) {
  if (chunks.length === 0) return [];

  const stopwords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "and", "or", "but",
    "if", "then", "when", "where", "why", "how", "what", "which", "who",
    "this", "that", "these", "those", "i", "you", "he", "she", "it", "we",
    "they", "for", "to", "of", "in", "on", "at", "by", "with", "from",
  ]);

  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopwords.has(t));

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return chunks.slice(0, topK);

  // Document frequency
  const docFreq = new Map<string, number>();
  for (const chunk of chunks) {
    const terms = new Set(tokenize(chunk.content));
    for (const t of terms) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
  }

  const N = chunks.length;
  const scored = chunks.map((chunk) => {
    const tokens = tokenize(chunk.content);
    let score = 0;
    for (const qt of queryTerms) {
      const df = docFreq.get(qt) || 0;
      if (df === 0) {
        // partial match
        if (tokens.some((t) => t.includes(qt) || qt.includes(t))) score += 0.3;
        continue;
      }
      const idf = Math.log(N / df);
      const tf = tokens.filter((t) => t === qt).length;
      score += tf * idf;
    }
    return { ...chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, ...rest }) => rest);
}
