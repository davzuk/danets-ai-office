import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { aiChat, logUsage } from "@/lib/ai";
import { withSession } from "@/lib/api";
import { requireAiQuota } from "@/lib/plan-limits";

const schema = z.object({
  quoteRequestId: z.string().min(1, "quoteRequestId is required"),
});

const DEFAULT_QUOTE_PROMPT =
  "You are a senior solutions consultant. Generate a professional project proposal based on the provided brief. Use simple markdown formatting (headings, lists, bold). Do NOT use tables. Include the following sections: Project Summary, Scope of Work, Deliverables, Timeline, Pricing Guidance (placeholder ranges), Terms and Conditions (placeholder), Next Steps. Tone: professional, clear, concise.";

// POST /api/quotes/generate — (re)generate a proposal for an existing QuoteRequest.
// Verifies businessId ownership, fetches the "quote" AiPromptTemplate (or default),
// builds a brief from the stored fields, calls aiChat, persists a GeneratedDocument,
// logs usage and flips the quote status to "generated".
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Invalid request");
    }

    const quoteRequestId = parsed.data.quoteRequestId;

    const qr = await db.quoteRequest.findFirst({
      where: { id: quoteRequestId, businessId: user.businessId },
    });
    if (!qr) throw new Error("FORBIDDEN");

    await requireAiQuota(user.businessId);

    const template = await db.aiPromptTemplate.findFirst({
      where: { businessId: user.businessId, type: "quote", isActive: true },
      select: { content: true },
    });

    const systemPrompt = template?.content?.trim()
      ? template.content.trim()
      : DEFAULT_QUOTE_PROMPT;

    const briefLines = [
      `Client name: ${qr.clientName}`,
      qr.companyName ? `Company: ${qr.companyName}` : null,
      `Service needed: ${qr.service}`,
      `Requirements: ${qr.requirements}`,
      qr.budgetRange ? `Budget range: ${qr.budgetRange}` : null,
      qr.timeline ? `Timeline: ${qr.timeline}` : null,
      qr.notes ? `Additional notes: ${qr.notes}` : null,
    ].filter(Boolean) as string[];

    const userPrompt = `Generate a professional project proposal in markdown based on this brief:\n\n${briefLines.join(
      "\n"
    )}\n\nUse the following section headings exactly (as level-2 markdown headings):\n## Project Summary\n## Scope of Work\n## Deliverables\n## Timeline\n## Pricing Guidance\n## Terms and Conditions\n## Next Steps\n\nPricing should be placeholder ranges (e.g. "$X,000 – $Y,000 USD"). Terms should be a placeholder list of standard items (payment schedule, IP, confidentiality, validity period). Keep the proposal professional, specific to the brief, and concise. Do not include any preamble or closing remarks outside the markdown.`;

    const result = await aiChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    await logUsage(user.businessId, "quote", {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    });

    const doc = await db.generatedDocument.create({
      data: {
        businessId: user.businessId,
        quoteRequestId: qr.id,
        type: "proposal",
        title: `Proposal - ${qr.clientName}`,
        content: result.content,
      },
    });

    await db.quoteRequest.update({
      where: { id: qr.id },
      data: { status: "generated" },
    });

    return {
      document: {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        type: doc.type,
        createdAt: doc.createdAt,
        quoteRequestId: qr.id,
      },
      tokens: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
    };
  });
}
