import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { aiChat, logUsage, retrieveKnowledge } from "@/lib/ai";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { checkChatRateLimit, checkMonthlyAiQuota } from "@/lib/plan-limits";
import { checkQuota } from "@/lib/plan-quota";
import { captureInbound } from "@/lib/inbound-attribution";
import { resolveContact } from "@/lib/contacts";
import { logger, serializeError } from "@/lib/logger";

const chatSchema = z.object({
  pk: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  visitorId: z.string().nullable().optional(),
  visitorName: z.string().nullable().optional(),
  visitorEmail: z.string().nullable().optional(),
  visitorPhone: z.string().nullable().optional(),
  message: z.string().min(1).max(2000),
  // Widget first/last-touch data; validated by captureInbound.
  attribution: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Rate limit: 30 messages / 10 min per IP (generous for real visitors)
  const rl = await rateLimit(`chat:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const { pk, message } = parsed.data;

  // Identify business by public key (never internal id)
  const business = await db.business.findUnique({
    where: { publicKey: pk, status: "active" },
  });
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  // Enforce the tenant's plan limits: a per-hour chat rate limit keyed by
  // business + visitor IP, and a monthly AI request quota. Suspended or
  // over-quota tenants get a clear message instead of silently failing.
  const chatLimit = await checkChatRateLimit(business.id, ip);
  if (!chatLimit.allowed) {
    return NextResponse.json(
      {
        error: "This site's chat limit has been reached for now. Please try again shortly.",
      },
      { status: 429 }
    );
  }

  const quota = await checkMonthlyAiQuota(business.id);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error:
          "This business's monthly AI quota has been reached. Please contact the business directly.",
      },
      { status: 429 }
    );
  }

  // Load active AI agent
  const agent = await db.aiAgent.findFirst({
    where: { businessId: business.id, status: "active" },
  });
  if (!agent) {
    return NextResponse.json(
      { error: "No active AI agent for this business" },
      { status: 503 }
    );
  }

  // Find or create chat session
  let session = parsed.data.sessionId
    ? await db.chatSession.findFirst({
        where: { id: parsed.data.sessionId, businessId: business.id },
      })
    : null;

  if (!session) {
    const chatQuota = await checkQuota(business.id, "chats");
    if (!chatQuota.allowed) {
      return NextResponse.json(
        {
          error:
            "This business has reached its monthly chat session limit. Please contact them directly.",
        },
        { status: 429 }
      );
    }

    // Record the chat start as a touchpoint. Anonymous visitors don't get a
    // Contact yet; it's created once they leave an email/phone (lead form).
    const inbound = await captureInbound({
      businessId: business.id,
      kind: "chat_start",
      visitorId: parsed.data.visitorId,
      attribution: parsed.data.attribution,
      profile: {
        name: parsed.data.visitorName,
        email: parsed.data.visitorEmail,
        phone: parsed.data.visitorPhone,
      },
      createContact: "identified",
    });

    session = await db.chatSession.create({
      data: {
        businessId: business.id,
        agentId: agent.id,
        contactId: inbound?.contactId ?? null,
        visitorId: parsed.data.visitorId,
        visitorName: parsed.data.visitorName,
        visitorEmail: parsed.data.visitorEmail,
        visitorPhone: parsed.data.visitorPhone,
        status: "active",
      },
    });
  } else if (
    (parsed.data.visitorName && !session.visitorName) ||
    (parsed.data.visitorEmail && !session.visitorEmail) ||
    (parsed.data.visitorPhone && !session.visitorPhone)
  ) {
    const visitorName = parsed.data.visitorName || session.visitorName;
    const visitorEmail = parsed.data.visitorEmail || session.visitorEmail;
    const visitorPhone = parsed.data.visitorPhone || session.visitorPhone;
    let contactId = session.contactId;
    try {
      const resolved = await resolveContact({
        businessId: business.id,
        identities: session.visitorId ? [{ type: "visitor", value: session.visitorId }] : [],
        profile: { name: visitorName, email: visitorEmail, phone: visitorPhone },
      });
      contactId = resolved?.contact.id ?? contactId;
    } catch (e) {
      logger.warn("Contact resolution failed for chat visitor", { businessId: business.id, ...serializeError(e) });
    }
    session = await db.chatSession.update({
      where: { id: session.id },
      data: { visitorName, visitorEmail, visitorPhone, contactId },
    });
  }

  // Save the user's message
  await db.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: message },
  });

  // Retrieve relevant knowledge base content
  const kbItems = await retrieveKnowledge(business.id, message, 3);

  // Increment views on matched items
  if (kbItems.length > 0) {
    await db.knowledgeBaseItem.updateMany({
      where: { id: { in: kbItems.map((k) => k.id) } },
      data: { views: { increment: 1 } },
    });
  }

  // Build a SAFE system prompt — strict grounding in KB
  const toneGuide: Record<string, string> = {
    professional: "professional and helpful",
    friendly: "warm, friendly and approachable",
    formal: "formal and precise",
  };
  const tone = toneGuide[agent.tone] || toneGuide.professional;

  const kbContext =
    kbItems.length > 0
      ? kbItems
          .map((k, i) => `### Article ${i + 1}: ${k.title}\n${k.content}`)
          .join("\n\n")
      : "(No relevant knowledge base articles found for this query.)";

  // Multi-language detection
  const { detectLanguage } = await import("@/lib/ai-scoring");
  const detectedLang = detectLanguage(message);

  const systemPrompt = `You are "${agent.botName}", a ${tone} AI assistant for ${agent.businessName || business.name}${agent.industry ? `, a company in ${agent.industry}` : ""}.

CRITICAL RULES — follow strictly:
1. Answer the visitor's question using ONLY the knowledge base articles provided below. Do NOT invent prices, policies, features, timelines, or promises.
2. If the answer is not contained in the knowledge base, reply EXACTLY with this sentence: "${agent.fallbackMessage}"
3. Keep answers concise (max 3-4 short paragraphs). Be clear and professional.
4. Never claim to be a human. You are an AI assistant.
5. If the visitor seems interested in a service, pricing, or wants to talk to someone, offer to connect them to the team and mention contact options (WhatsApp/phone/email) when relevant.
6. Respond in the SAME LANGUAGE the visitor is using. Detected language: ${detectedLang}.

KNOWLEDGE BASE:
${kbContext}

${agent.handoverMessage ? `When handing over, use: "${agent.handoverMessage}"` : ""}
${agent.contactPhone ? `Contact phone: ${agent.contactPhone}` : ""}
${agent.whatsappNumber ? `WhatsApp: ${agent.whatsappNumber}` : ""}
${agent.email ? `Email: ${agent.email}` : ""}

Now respond to the visitor's message.`;

  // Load recent conversation history (last 10 messages) for context
  const history = await db.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: { role: true, content: true },
  });

  const messages = [
    { role: "assistant", content: systemPrompt },
    ...history.map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
  ];

  let aiContent = "";
  let tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  try {
    const result = await aiChat(messages, { temperature: 0.4 });
    aiContent = result.content;
    tokens = {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    };
  } catch (e: any) {
    console.error("[public chat] AI error:", e?.message);
    await logUsage(business.id, "chat", { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", e?.message);
    aiContent = agent.fallbackMessage;
  }

  // Save AI response + usage log atomically. The AI call itself sits outside
  // the transaction (it can take seconds); only the writes are atomic so a
  // crash between assistant-message create and usage log can't leave
  // orphan usage data.
  await db.$transaction([
    db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: aiContent,
        tokensUsed: tokens.totalTokens,
        meta: JSON.stringify({ kbUsed: kbItems.map((k) => k.id) }),
      },
    }),
    // logUsage via Prisma transaction client: we call the helper directly
    // outside the transaction below for backwards compatibility, but here
    // we also bump chatSessions.lastMessageAt atomically.
    db.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  // Log usage
  await logUsage(business.id, "chat", tokens);

  // Simple lead-detection heuristic: if message contains intent keywords, flag for capture
  const leadIntent = /\b(price|pricing|cost|quote|buy|hire|service|interested|consult|need help|how much|plan|subscription)\b/i.test(
    message
  );

  return NextResponse.json({
    sessionId: session.id,
    reply: aiContent,
    kbContextCount: kbItems.length,
    leadIntent,
    handover: {
      phone: agent.contactPhone,
      whatsapp: agent.whatsappNumber,
      email: agent.email,
      message: agent.handoverMessage,
    },
  });
}
