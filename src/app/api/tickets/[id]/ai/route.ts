import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { aiChat, logUsage } from "@/lib/ai";
import { checkMonthlyAiQuota, quotaExceededResponse } from "@/lib/plan-limits";

const aiSchema = z.object({
  action: z.enum(["summary", "suggest_reply", "detect_priority", "full_analysis"]),
});

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/tickets/[id]/ai — AI-powered ticket assistance
// Actions: summary | suggest_reply | detect_priority | full_analysis
// AI outputs are stored on the ticket for review — NEVER auto-sent.
export async function POST(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticket = await db.supportTicket.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      category: { select: { name: true } },
    },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = aiSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const action = parsed.data.action;

  const quota = await checkMonthlyAiQuota(user.businessId);
  if (!quota.allowed) return quotaExceededResponse();

  // Build conversation transcript
  const transcript = ticket.messages
    .map((m) => {
      const speaker = m.role === "customer" ? "Customer" : m.role === "agent" ? "Agent" : "System";
      return `${speaker}: ${m.content}`;
    })
    .join("\n");

  const ticketContext = `Ticket Subject: ${ticket.subject}
Description: ${ticket.description}
Category: ${ticket.category?.name || "Uncategorized"}
Current Priority: ${ticket.priority}
Current Status: ${ticket.status}
Customer: ${ticket.customerName || "Unknown"}

Conversation:
${transcript || "(No messages yet)"}`;

  let systemPrompt = "";
  let userPrompt = "";
  let result: any = {};

  if (action === "summary") {
    systemPrompt = `You are an AI support assistant. Summarize this support ticket in 2-3 sentences. Focus on the customer's issue and current resolution state. Be concise and professional.`;
    userPrompt = ticketContext;
    const res = await aiChat(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.3 }
    );
    result.aiSummary = res.content;
    await db.supportTicket.update({ where: { id }, data: { aiSummary: res.content } });
    await logUsage(user.businessId, "summary", res, "success");
  } else if (action === "suggest_reply") {
    systemPrompt = `You are a professional customer support agent. Draft a helpful, empathetic reply to this customer's support ticket.

Rules:
- Be professional, friendly, and concise.
- Address the customer's specific issue.
- If you don't know the answer, suggest they contact the team.
- Do NOT make up policies, prices, or guarantees.
- Sign off as "The Support Team".
- Output ONLY the reply message, no preamble.`;
    userPrompt = ticketContext;
    const res = await aiChat(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.5 }
    );
    result.aiSuggestedReply = res.content;
    await db.supportTicket.update({ where: { id }, data: { aiSuggestedReply: res.content } });
    await logUsage(user.businessId, "suggested_reply", res, "success");
  } else if (action === "detect_priority") {
    systemPrompt = `You are an AI that analyzes support ticket priority and sentiment. Respond with STRICT JSON only — no markdown, no commentary.

JSON shape:
{
  "priority": "low" | "medium" | "high" | "urgent",
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "reason": "string — brief explanation of why this priority"
}

Priority guidelines:
- urgent: customer is blocked, angry, or threatens to cancel
- high: significant issue affecting their business
- medium: normal support request
- low: general question or minor issue`;
    userPrompt = ticketContext;
    const res = await aiChat(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.3 }
    );
    try {
      // Parse JSON defensively
      let cleaned = res.content.trim();
      const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) cleaned = fenceMatch[1].trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        const json = JSON.parse(cleaned.slice(start, end + 1));
        result.aiPriority = json.priority || "medium";
        result.aiSentiment = json.sentiment || "neutral";
        result.aiPriorityReason = json.reason || "";
        await db.supportTicket.update({
          where: { id },
          data: {
            aiPriority: result.aiPriority,
            aiSentiment: result.aiSentiment,
          },
        });
      }
    } catch {
      result.aiPriority = "medium";
      result.aiSentiment = "neutral";
      result.aiPriorityReason = "Could not parse AI response";
    }
    await logUsage(user.businessId, "summary", res, "success");
  } else if (action === "full_analysis") {
    systemPrompt = `You are an AI support ticket analyzer. Analyze this ticket and respond with STRICT JSON only — no markdown, no commentary.

JSON shape:
{
  "summary": "2-3 sentence summary of the issue",
  "suggested_reply": "a professional draft reply to the customer",
  "priority": "low" | "medium" | "high" | "urgent",
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "next_action": "recommended next step for the support team"
}

Rules:
- Do NOT invent policies, prices, or guarantees.
- If unsure, suggest contacting the team.
- Keep the suggested_reply concise and professional.`;
    userPrompt = ticketContext;
    const res = await aiChat(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.4 }
    );
    try {
      let cleaned = res.content.trim();
      const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) cleaned = fenceMatch[1].trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        const json = JSON.parse(cleaned.slice(start, end + 1));
        result.aiSummary = json.summary || "";
        result.aiSuggestedReply = json.suggested_reply || "";
        result.aiPriority = json.priority || "medium";
        result.aiSentiment = json.sentiment || "neutral";
        result.aiNextAction = json.next_action || "";
        await db.supportTicket.update({
          where: { id },
          data: {
            aiSummary: result.aiSummary,
            aiSuggestedReply: result.aiSuggestedReply,
            aiPriority: result.aiPriority,
            aiSentiment: result.aiSentiment,
            aiNextAction: result.aiNextAction,
          },
        });
      }
    } catch {
      result.error = "Could not parse AI response";
    }
    await logUsage(user.businessId, "summary", res, "success");
  }

  return NextResponse.json({ action, result, ticketId: id });
}
