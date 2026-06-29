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

// ─── Knowledge base retrieval (TF-IDF scoring) ────────────────────
// Ranks KB items using term frequency–inverse document frequency,
// with title-match boosting and partial-match (substring) fallback.
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

  // Tokenize query (remove stopwords, keep terms > 2 chars)
  const stopwords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "and", "or",
    "but", "if", "then", "else", "when", "where", "why", "how", "what",
    "which", "who", "whom", "this", "that", "these", "those", "i", "you",
    "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "for", "to", "of", "in",
    "on", "at", "by", "with", "from", "as", "into", "about", "than",
  ]);

  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopwords.has(t));

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Build document frequency map (how many items contain each term)
  const docFreq = new Map<string, number>();
  const docTokens = items.map((item) => {
    const titleTokens = tokenize(item.title);
    const contentTokens = tokenize(item.content);
    const allTokens = [...titleTokens, ...contentTokens];
    const uniqueTerms = new Set(allTokens);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
    return { item, titleTokens, contentTokens, allTokens };
  });

  const N = items.length;

  // Compute TF-IDF score for each item
  const scored = docTokens.map(({ item, titleTokens, contentTokens, allTokens }) => {
    let score = 0;
    const titleSet = new Set(titleTokens);

    for (const qt of queryTerms) {
      // IDF: rarer terms score higher
      const df = docFreq.get(qt) || 0;
      if (df === 0) {
        // Term not in any doc — try partial (substring) match as fallback
        let partialHits = 0;
        for (const t of allTokens) {
          if (t.includes(qt) || qt.includes(t)) partialHits++;
        }
        if (partialHits > 0) score += 0.3 * partialHits;
        continue;
      }
      const idf = Math.log(N / df);

      // TF in content
      let tfContent = 0;
      for (const t of contentTokens) if (t === qt) tfContent++;
      // TF in title (weighted higher)
      let tfTitle = 0;
      for (const t of titleTokens) if (t === qt) tfTitle++;

      score += tfContent * idf;
      score += tfTitle * idf * 3; // title matches are 3x more important

      // Exact title token match bonus
      if (titleSet.has(qt)) score += idf * 2;
    }

    return { ...item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, ...rest }) => rest);
}
