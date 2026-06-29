import "server-only";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

// Singleton SDK instance
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function aiChat(
  messages: { role: string; content: string }[],
  opts?: { temperature?: number }
): Promise<ChatResult> {
  const zai = await getZai();
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role as any, content: m.content })),
    thinking: { type: "disabled" },
    temperature: opts?.temperature,
  } as any);

  const content = completion.choices[0]?.message?.content || "";
  const usage = (completion as any).usage;
  const promptTokens = usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join(""));
  const completionTokens = usage?.completion_tokens ?? estimateTokens(content);
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

  return { content, promptTokens, completionTokens, totalTokens };
}

// Log usage + cost (rough estimate: $0.002 / 1K tokens)
export async function logUsage(
  businessId: string,
  feature: string,
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number },
  status: "success" | "error" = "success",
  error?: string
) {
  const costUsd = (tokens.totalTokens / 1000) * 0.002;
  await db.aiUsageLog
    .create({
      data: {
        businessId,
        feature,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        totalTokens: tokens.totalTokens,
        costUsd,
        status,
        error,
      },
    })
    .catch(() => {});
}

// ─── Knowledge base retrieval (simple keyword + title match) ───────
// MVP retrieval: rank KB items by simple scoring. Upgrade to embeddings later.
export async function retrieveKnowledge(
  businessId: string,
  query: string,
  topK = 3
) {
  const items = await db.knowledgeBaseItem.findMany({
    where: { businessId, status: "active" },
    select: { id: true, title: true, content: true, category: true },
  });

  if (items.length === 0) return [];

  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);

  const scored = items.map((item) => {
    const text = `${item.title} ${item.content}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (text.includes(t)) score += 1;
      if (item.title.toLowerCase().includes(t)) score += 2;
    }
    // whole-query match bonus
    if (text.includes(q)) score += 3;
    return { ...item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, ...rest }) => rest);
}
