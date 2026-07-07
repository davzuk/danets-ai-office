import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { aiChat, logUsage } from "@/lib/ai";
import { requireAiQuota } from "@/lib/plan-limits";

// POST /api/conversations/[id]/suggestions
// Generates AI suggested replies for the conversation. Updates the ChatSession
// (summary, leadQuality, nextAction) and logs token usage. Returns the parsed
// suggestions, or { raw: true, text, parsed: false } if JSON parsing fails.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;

    // ── Load session + messages, verify ownership ──────────────────────
    const session = await db.chatSession.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true, createdAt: true },
        },
      },
    });

    if (!session || session.businessId !== user.businessId) {
      return { error: "Conversation not found", suggestions: null };
    }

    await requireAiQuota(user.businessId);

    if (!session.messages || session.messages.length === 0) {
      return {
        error: "No messages in this conversation to analyze.",
        suggestions: null,
      };
    }

    // ── Build the transcript ───────────────────────────────────────────
    const transcript = session.messages
      .map((m) => {
        const speaker =
          m.role === "user"
            ? "Visitor"
            : m.role === "assistant"
            ? "Assistant"
            : "System";
        return `${speaker}: ${m.content}`;
      })
      .join("\n");

    // ── Fetch the suggested_reply template (or use default) ────────────
    const template = await db.aiPromptTemplate.findFirst({
      where: {
        businessId: user.businessId,
        type: "suggested_reply",
        isActive: true,
      },
      select: { content: true },
    });

    const systemPrompt =
      template?.content?.trim() ||
      `You are an AI assistant that analyzes customer chat conversations for a business team.
Read the conversation transcript carefully and produce a structured analysis.

You MUST respond with STRICT JSON only — no markdown fences, no commentary, no preamble.
The JSON must exactly match this shape:
{
  "summary": "string — 2-3 sentence summary of what the visitor wanted and the current state of the conversation",
  "follow_up_message": "string — a short, professional follow-up message the business team could send to the visitor",
  "lead_quality": "low" | "medium" | "high",
  "next_action": "string — recommended next step for the business team (e.g. call, email, send quote, mark as won)"
}

Guidelines:
- "lead_quality" must be one of "low", "medium", or "high".
- "follow_up_message" should be 1-3 sentences, friendly, professional, and reference the visitor's needs.
- "next_action" should be a single concrete action the team should take.
- Keep all values as plain strings (no markdown, no newlines inside strings if avoidable).`;

    const messagesForAI = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Conversation transcript:\n\n${transcript}\n\nRespond with strict JSON only.`,
      },
    ];

    // ── Call the AI ────────────────────────────────────────────────────
    let result;
    try {
      result = await aiChat(messagesForAI, { temperature: 0.4 });
    } catch (e: any) {
      await logUsage(
        user.businessId,
        "suggested_reply",
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        "error",
        `AI call failed: ${e?.message || String(e)}`
      );
      return {
        error: "AI service unavailable. Please try again.",
        suggestions: null,
      };
    }

    // ── Parse the response defensively ─────────────────────────────────
    const parsed = parseSuggestionsJson(result.content);

    if (parsed) {
      // Normalize / validate fields
      const leadQualityRaw = String(parsed.lead_quality || "").toLowerCase();
      const leadQuality = ["low", "medium", "high"].includes(leadQualityRaw)
        ? (leadQualityRaw as "low" | "medium" | "high")
        : "medium";

      const summary = clampStr(parsed.summary, 1000);
      const followUp = clampStr(parsed.follow_up_message, 2000);
      const nextAction = clampStr(parsed.next_action, 1000);

      // Persist summary / leadQuality / nextAction on the session
      await db.chatSession.update({
        where: { id: session.id },
        data: {
          summary: summary || null,
          leadQuality,
          nextAction: nextAction || null,
        },
      });

      await logUsage(user.businessId, "suggested_reply", {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      });

      return {
        suggestions: {
          summary,
          follow_up_message: followUp,
          lead_quality: leadQuality,
          next_action: nextAction,
          parsed: true as const,
        },
      };
    }

    // Parsing failed — return raw text + a flag
    await logUsage(
      user.businessId,
      "suggested_reply",
      {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
      "error",
      "Suggested-reply JSON parsing failed"
    );

    return {
      suggestions: {
        parsed: false as const,
        raw: true as const,
        text: result.content,
      },
    };
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function parseSuggestionsJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let cleaned = text.trim();

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find the outermost { ... } block
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonStr = cleaned.slice(start, end + 1);
  try {
    const obj = JSON.parse(jsonStr);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
