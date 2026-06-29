import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { aiChat, logUsage } from "@/lib/ai";
import { withSession } from "@/lib/api";

const createSchema = z.object({
  clientName: z.string().min(1, "Client name is required").max(120),
  companyName: z.string().max(120).optional().nullable(),
  service: z.string().min(1, "Service is required").max(200),
  requirements: z.string().min(1, "Requirements are required").max(4000),
  budgetRange: z.string().max(60).optional().nullable(),
  timeline: z.string().max(60).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const DEFAULT_QUOTE_PROMPT =
  "You are a senior solutions consultant. Generate a professional project proposal based on the provided brief. Use simple markdown formatting (headings, lists, bold). Do NOT use tables. Include the following sections: Project Summary, Scope of Work, Deliverables, Timeline, Pricing Guidance (placeholder ranges), Terms and Conditions (placeholder), Next Steps. Tone: professional, clear, concise.";

/**
 * Build the AI prompt + brief from a QuoteRequest, call the model, persist the
 * GeneratedDocument and update the quote status. Returns the document + token
 * counts so callers can show cost feedback in the UI.
 */
async function generateProposalForQuote(
  quoteRequestId: string,
  businessId: string
) {
  const qr = await db.quoteRequest.findFirst({
    where: { id: quoteRequestId, businessId },
  });
  if (!qr) throw new Error("FORBIDDEN");

  const template = await db.aiPromptTemplate.findFirst({
    where: { businessId, type: "quote", isActive: true },
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

  await logUsage(businessId, "quote", {
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    totalTokens: result.totalTokens,
  });

  const doc = await db.generatedDocument.create({
    data: {
      businessId,
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
    document: doc,
    tokens: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    },
  };
}

// GET /api/quotes — list QuoteRequests for the business, with latest proposal doc.
export async function GET() {
  return withSession(async (user) => {
    const quotes = await db.quoteRequest.findMany({
      where: { businessId: user.businessId },
      include: {
        documents: {
          where: { type: "proposal" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      quotes: quotes.map((q) => ({
        id: q.id,
        clientName: q.clientName,
        companyName: q.companyName,
        service: q.service,
        requirements: q.requirements,
        budgetRange: q.budgetRange,
        timeline: q.timeline,
        notes: q.notes,
        status: q.status,
        createdAt: q.createdAt,
        latestDocument: q.documents[0]
          ? {
              id: q.documents[0].id,
              title: q.documents[0].title,
              content: q.documents[0].content,
              type: q.documents[0].type,
              createdAt: q.documents[0].createdAt,
            }
          : null,
      })),
    };
  });
}

// POST /api/quotes — create a QuoteRequest and immediately generate the proposal.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues[0]?.message ?? "Invalid request input"
      );
    }

    const {
      clientName,
      companyName,
      service,
      requirements,
      budgetRange,
      timeline,
      notes,
    } = parsed.data;

    const quote = await db.quoteRequest.create({
      data: {
        businessId: user.businessId,
        clientName: clientName.trim(),
        companyName: companyName?.trim() || null,
        service: service.trim(),
        requirements: requirements.trim(),
        budgetRange: budgetRange?.trim() || null,
        timeline: timeline?.trim() || null,
        notes: notes?.trim() || null,
        status: "draft",
      },
    });

    // Immediately generate the proposal via AI. If this fails the quote is
    // still saved as a draft so the user can retry via /api/quotes/generate.
    try {
      const { document, tokens } = await generateProposalForQuote(
        quote.id,
        user.businessId
      );
      return {
        quote: {
          id: quote.id,
          clientName: quote.clientName,
          companyName: quote.companyName,
          service: quote.service,
          requirements: quote.requirements,
          budgetRange: quote.budgetRange,
          timeline: quote.timeline,
          notes: quote.notes,
          status: "generated",
          createdAt: quote.createdAt,
        },
        document,
        tokens,
      };
    } catch (e: any) {
      console.error("[quotes POST] AI generation failed:", e);
      throw new Error(
        "Quote saved as draft, but AI generation failed. Open the quote and click Regenerate."
      );
    }
  });
}
