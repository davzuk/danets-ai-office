import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logUsage, type UsageInput } from "@/lib/ai";
import { detectBookingIntent, generateAgentReply } from "@/lib/agent-reply";
import { isModuleEnabled } from "@/lib/module-access";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { checkChatRateLimit, checkMonthlyAiQuota } from "@/lib/plan-limits";
import { startWidgetSession } from "@/lib/widget-session";
import { resolveContact } from "@/lib/contacts";
import { logger, serializeError } from "@/lib/logger";
import { blockedOriginFor, publicPreflight, readPageContext, withPublicCors } from "@/lib/public-cors";

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
  // { url, title } of the page the visitor is on; cleaned by readPageContext.
  page: z.unknown().optional(),
  // The proactive message the visitor saw before this chat started.
  ruleId: z.string().max(191).nullable().optional(),
});

export const OPTIONS = publicPreflight;

export const POST = withPublicCors(async (req: NextRequest) => {
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
  const blocked = await blockedOriginFor(req, business);
  if (blocked) return blocked;
  const page = readPageContext(parsed.data.page);

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
    const started = await startWidgetSession({
      businessId: business.id,
      agentId: agent.id,
      visitorId: parsed.data.visitorId,
      attribution: parsed.data.attribution,
      profile: {
        name: parsed.data.visitorName,
        email: parsed.data.visitorEmail,
        phone: parsed.data.visitorPhone,
      },
      page,
      ruleId: parsed.data.ruleId,
    });
    if ("error" in started) {
      return NextResponse.json({ error: started.error }, { status: started.status });
    }
    session = started.session;
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

  // KB-grounded reply (shared with the social inbox).
  const reply = await generateAgentReply({ business, agent, sessionId: session.id, message, channel: "widget", page });
  const aiContent = reply.content;
  const tokens: UsageInput = reply.usage;
  const kbItems = reply.kbIds;

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
        meta: JSON.stringify({ kbUsed: kbItems }),
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

  // Log usage (failures were already logged by generateAgentReply)
  if (!reply.failed) await logUsage(business.id, "chat", tokens);

  const leadIntent = reply.leadIntent;
  // Offer the booking step only when this business actually takes bookings.
  const booking =
    detectBookingIntent(parsed.data.message) &&
    (await isModuleEnabled(business.id, "leads", business.plan)) &&
    (await db.bookingType.count({ where: { businessId: business.id, active: true } })) > 0;

  return NextResponse.json({
    sessionId: session.id,
    reply: aiContent,
    kbContextCount: kbItems.length,
    leadIntent,
    booking,
    handover: {
      phone: agent.contactPhone,
      whatsapp: agent.whatsappNumber,
      email: agent.email,
      message: agent.handoverMessage,
    },
  });
});
