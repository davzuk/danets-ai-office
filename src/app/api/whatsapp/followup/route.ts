import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiChat, logUsage, EMPTY_USAGE, type UsageInput } from "@/lib/ai";
import { checkMonthlyAiQuota, quotaExceededResponse } from "@/lib/plan-limits";

const followupSchema = z.object({
  leadId: z.string().optional(),
  context: z.enum(["new_lead", "missed_chat", "quotation", "payment", "appointment", "ticket"]).default("new_lead"),
  recipientName: z.string().optional(),
  service: z.string().optional(),
  company: z.string().optional(),
  customNote: z.string().max(500).optional(),
});

// POST /api/whatsapp/followup — generate an AI follow-up message draft
// Returns a draft for the admin to review, edit, and send manually.
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = followupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const d = parsed.data;

  const quota = await checkMonthlyAiQuota(user.businessId);
  if (!quota.allowed) return quotaExceededResponse();

  // If leadId provided, load lead info
  let leadInfo = "";
  if (d.leadId) {
    const lead = await db.lead.findFirst({
      where: { id: d.leadId, businessId: user.businessId },
      select: { name: true, service: true, message: true, quality: true, company: true },
    });
    if (lead) {
      leadInfo = `Lead name: ${lead.name}
Service: ${lead.service || "N/A"}
Company: ${lead.company || "N/A"}
Quality: ${lead.quality}
Original message: ${lead.message || "N/A"}`;
    }
  }

  const contextMap: Record<string, string> = {
    new_lead: "follow up with a new lead who just expressed interest",
    missed_chat: "follow up with a visitor whose chat was missed or ended without resolution",
    quotation: "follow up on a proposal/quotation that was sent",
    payment: "send a payment reminder",
    appointment: "confirm an appointment or meeting",
    ticket: "update a customer about their support ticket",
  };

  const systemPrompt = `You are a professional business communication assistant. Draft a concise WhatsApp follow-up message.

Rules:
- Keep it under 150 words — WhatsApp messages should be brief.
- Be friendly but professional.
- Include a clear call to action.
- Do NOT invent prices, dates, or policies.
- Use the business name "${user.businessName}".
- Output ONLY the message text, no preamble or quotation marks.
- Use {name} placeholder if the recipient name is unknown.`;

  const userPrompt = `Context: ${contextMap[d.context]}

${leadInfo}

Recipient name: ${d.recipientName || "{name}"}
Service: ${d.service || "N/A"}
Company: ${d.company || "N/A"}
${d.customNote ? `Additional note: ${d.customNote}` : ""}

Draft a WhatsApp follow-up message:`;

  let draft = "";
  let tokens: UsageInput = EMPTY_USAGE;

  try {
    const result = await aiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { businessId: user.businessId, task: "content", temperature: 0.5 }
    );
    draft = result.content;
    tokens = result;
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to generate follow-up: " + e?.message },
      { status: 500 }
    );
  }

  await logUsage(user.businessId, "suggested_reply", tokens, "success");

  return NextResponse.json({
    draft,
    tokens: tokens.totalTokens,
    note: "Review and edit before sending — AI drafts are not auto-sent.",
  });
}
