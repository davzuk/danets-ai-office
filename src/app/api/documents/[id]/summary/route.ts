import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiChat, logUsage } from "@/lib/ai";
import { checkMonthlyAiQuota, quotaExceededResponse } from "@/lib/plan-limits";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/documents/[id]/summary — generate an AI summary of the document
export async function POST(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, businessId: user.businessId },
    select: { id: true, title: true, content: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quota = await checkMonthlyAiQuota(user.businessId);
  if (!quota.allowed) return quotaExceededResponse();

  // Truncate content to ~4000 chars for the summary prompt
  const content = doc.content.slice(0, 4000);

  const systemPrompt = `You are a document summarizer. Create a concise summary of the document below in 3-5 sentences. Focus on the key points, main arguments, and important details. Be factual and do not add information not present in the document.`;

  let summary = "";
  let tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    const result = await aiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Document: ${doc.title}\n\n${content}` },
      ],
      { temperature: 0.3 }
    );
    summary = result.content;
    tokens = {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    };
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to generate summary: " + e?.message },
      { status: 500 }
    );
  }

  // Save summary to document
  await db.document.update({
    where: { id },
    data: { summary },
  });

  await logUsage(user.businessId, "summary", tokens, "success");

  return NextResponse.json({ summary, tokens: tokens.totalTokens });
}
