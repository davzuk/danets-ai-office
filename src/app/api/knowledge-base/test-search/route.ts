import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { retrieveKnowledge } from "@/lib/ai";

const schema = z.object({
  query: z.string().min(1).max(500),
});

// POST /api/knowledge-base/test-search
// Tests a visitor query against the KB retrieval system and returns
// the matched articles with their relevance scores, so admins can
// verify the AI will find the right content before going live.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const { query } = parsed.data;

    // Get matched items via the same TF-IDF retrieval used by the chatbot
    const matched = await retrieveKnowledge(user.businessId, query, 5);

    // Also get total active KB count for context
    const totalActive = await db.knowledgeBaseItem.count({
      where: { businessId: user.businessId, status: "active" },
    });

    return {
      query,
      totalActiveKb: totalActive,
      matchedCount: matched.length,
      matches: matched.map((m, i) => ({
        rank: i + 1,
        id: m.id,
        title: m.title,
        category: m.category,
        contentPreview: m.content.slice(0, 200) + (m.content.length > 200 ? "…" : ""),
      })),
    };
  });
}
