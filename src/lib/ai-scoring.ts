import "server-only";
import { db } from "@/lib/db";
import { aiChat, logUsage } from "@/lib/ai";

export async function scoreLead(leadId: string, businessId: string): Promise<number> {
  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      include: { session: { include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } } } },
    });
    if (!lead || lead.businessId !== businessId) return 0;

    const messages = lead.session?.messages || [];
    const transcript = messages.map((m) => `${m.role === "user" ? "Visitor" : "AI"}: ${m.content}`).join("\n").slice(0, 2000);

    let heuristicScore = 0;
    if (lead.email) heuristicScore += 15;
    if (lead.phone) heuristicScore += 15;
    if (lead.service) heuristicScore += 10;
    if (lead.message && lead.message.length > 20) heuristicScore += 10;
    if (lead.quality === "high") heuristicScore += 20;
    else if (lead.quality === "medium") heuristicScore += 10;
    if (messages.length >= 4) heuristicScore += 10;
    const msgText = `${lead.message || ""} ${transcript}`.toLowerCase();
    if (/\b(price|pricing|cost|budget|buy|hire|quote|proposal|contract|sign|pay)\b/.test(msgText)) heuristicScore += 10;
    if (/\b(urgent|asap|immediately|this week|deadline)\b/.test(msgText)) heuristicScore += 5;
    heuristicScore = Math.min(heuristicScore, 100);

    if (transcript.length > 100) {
      try {
        const result = await aiChat(
          [
            { role: "system", content: `You are a lead scoring AI. Respond with STRICT JSON only: {"score": number (0-100), "reason": "brief explanation"}. 80-100: highly qualified, 60-79: qualified, 40-59: lukewarm, 0-39: low quality.` },
            { role: "user", content: `Lead: ${lead.name}\nEmail: ${lead.email || "N/A"}\nPhone: ${lead.phone || "N/A"}\nService: ${lead.service || "N/A"}\nQuality: ${lead.quality}\nMessage: ${lead.message || "N/A"}\n\nConversation:\n${transcript || "(No conversation)"}\n\nScore this lead:` },
          ],
          { temperature: 0.3 }
        );
        let cleaned = result.content.trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          const parsed = JSON.parse(cleaned.slice(start, end + 1));
          const aiScore = Math.min(100, Math.max(0, parseInt(parsed.score) || heuristicScore));
          await logUsage(businessId, "summary", result, "success");
          const finalScore = Math.round(aiScore * 0.6 + heuristicScore * 0.4);
          await db.lead.update({ where: { id: leadId }, data: { leadScore: finalScore } });
          return finalScore;
        }
      } catch {}
    }

    await db.lead.update({ where: { id: leadId }, data: { leadScore: heuristicScore } });
    return heuristicScore;
  } catch (e) {
    console.error("[scoreLead] failed:", e);
    return 0;
  }
}

export async function analyzeDeflection(businessId: string): Promise<{
  unansweredQuestions: { question: string; count: number; suggestedAction: string }[];
  deflectionRate: number;
}> {
  try {
    const sessions = await db.chatSession.findMany({
      where: { businessId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      include: { messages: { where: { role: "user" }, select: { content: true }, take: 50 } },
      take: 100,
    });

    const agent = await db.aiAgent.findFirst({ where: { businessId }, select: { fallbackMessage: true } });
    const fallbackText = (agent?.fallbackMessage || "").toLowerCase().slice(0, 30);

    const sessionIds = sessions.map((s) => s.id);
    const assistantMessages = await db.chatMessage.findMany({
      where: { sessionId: { in: sessionIds }, role: "assistant" },
      select: { sessionId: true, content: true },
    });

    const fallbackSessions = new Set(
      assistantMessages.filter((m) => m.content.toLowerCase().includes(fallbackText)).map((m) => m.sessionId)
    );

    const totalSessions = sessions.length;
    const deflectedSessions = totalSessions - fallbackSessions.size;
    const deflectionRate = totalSessions > 0 ? Math.round((deflectedSessions / totalSessions) * 100) : 100;

    const unansweredMap = new Map<string, number>();
    for (const session of sessions) {
      if (fallbackSessions.has(session.id)) {
        for (const msg of session.messages) {
          const q = msg.content.trim().toLowerCase().replace(/[?.!]+$/, "").slice(0, 80);
          if (q.length < 3) continue;
          const key = q.split(" ").slice(0, 4).join(" ");
          unansweredMap.set(key, (unansweredMap.get(key) || 0) + 1);
        }
      }
    }

    const unansweredQuestions = Array.from(unansweredMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({
        question: key.charAt(0).toUpperCase() + key.slice(1) + "?",
        count,
        suggestedAction: `Add a KB article covering: "${key.charAt(0).toUpperCase() + key.slice(1)}"`,
      }));

    return { unansweredQuestions, deflectionRate };
  } catch (e) {
    console.error("[analyzeDeflection] failed:", e);
    return { unansweredQuestions: [], deflectionRate: 0 };
  }
}

export function detectLanguage(text: string): string {
  const lower = text.toLowerCase();
  const languageMarkers: Record<string, string[]> = {
    en: ["the", "and", "is", "are", "what", "how", "can", "you", "help", "please"],
    fr: ["le", "la", "et", "est", "que", "comment", "aidez", "bonjour", "merci"],
    es: ["el", "la", "y", "es", "que", "como", "ayuda", "hola", "gracias"],
    de: ["der", "die", "und", "ist", "was", "wie", "kann", "hilfe", "danke"],
    pt: ["o", "a", "e", "é", "que", "como", "ajuda", "olá", "obrigado"],
    ar: ["السلام", "عليكم", "كيف", "ما", "هل", "يمكن", "مساعدة", "شكرا"],
    sw: ["na", "ya", "ni", "kwa", "nini", "jinsi", "habari", "asante", "msaada"],
    ha: ["da", "na", "ne", "don", "me", "yaya", "sannu", "na gode", "taimako"],
  };

  let bestLang = "en";
  let bestScore = 0;
  for (const [lang, markers] of Object.entries(languageMarkers)) {
    let score = 0;
    for (const marker of markers) if (lower.includes(marker)) score++;
    if (score > bestScore) { bestScore = score; bestLang = lang; }
  }
  return bestLang;
}
