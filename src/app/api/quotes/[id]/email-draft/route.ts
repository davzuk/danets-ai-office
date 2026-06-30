import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiChat, logUsage } from "@/lib/ai";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/quotes/[id]/email-draft — generate an AI email draft to send the proposal
export async function POST(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const quote = await db.quoteRequest.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true },
  });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const systemPrompt = `You are a professional business development assistant. Draft an email to send a proposal to a client.

Rules:
- Be professional, warm, and concise.
- Reference the client's specific requirements.
- Mention the total price if it's > 0.
- Include a clear call to action (schedule a call or review the attached proposal).
- Do NOT invent details not provided.
- Sign off as "The ${user.businessName} Team".
- Output ONLY the email subject and body, separated by "---EMAIL---" on its own line.
- Format: Subject line first, then ---EMAIL---, then the email body.`;

  const userPrompt = `Client: ${quote.clientName}
Company: ${quote.companyName || "N/A"}
Service: ${quote.service}
Requirements: ${quote.requirements}
Budget: ${quote.budgetRange || "N/A"}
Timeline: ${quote.timeline || "N/A"}
Total Price: ${quote.total > 0 ? `${quote.currency} ${quote.total.toLocaleString()}` : "TBD"}
Items: ${quote.items.map((i) => `${i.description} (${i.quantity}x ${quote.currency}${i.unitPrice})`).join(", ") || "N/A"}
Business: ${user.businessName}

Draft the email:`;

  let draft = "";
  let tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    const result = await aiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.5 }
    );
    draft = result.content;
    tokens = {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    };
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to generate email draft: " + e?.message },
      { status: 500 }
    );
  }

  await logUsage(user.businessId, "suggested_reply", tokens, "success");

  // Parse subject and body
  let subject = `Proposal for ${quote.service}`;
  let body = draft;
  const separator = draft.indexOf("---EMAIL---");
  if (separator !== -1) {
    subject = draft.slice(0, separator).trim();
    body = draft.slice(separator + "---EMAIL---".length).trim();
  }

  return NextResponse.json({
    subject,
    body,
    tokens: tokens.totalTokens,
    mailtoLink: `mailto:${quote.clientName}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    note: "Review and edit before sending — AI drafts are not auto-sent.",
  });
}
