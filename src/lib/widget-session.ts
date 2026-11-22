// Starting a widget chat session: shared by the first chat message
// (/api/public/chat) and the pre-chat form (/api/public/session).

import type { ChatSession } from "@prisma/client";
import { db } from "@/lib/db";
import { checkQuota } from "@/lib/plan-quota";
import { captureInbound } from "@/lib/inbound-attribution";
import { logger, serializeError } from "@/lib/logger";
import type { PageContext } from "@/lib/agent-reply";

export interface StartWidgetSessionArgs {
  businessId: string;
  agentId: string;
  visitorId?: string | null;
  attribution?: unknown;
  profile: { name?: string | null; email?: string | null; phone?: string | null };
  page?: PageContext | null;
  /** The proactive message the visitor saw, as reported by the widget. */
  ruleId?: string | null;
}

export type StartWidgetSessionResult = { session: ChatSession } | { error: string; status: number };

export async function startWidgetSession(args: StartWidgetSessionArgs): Promise<StartWidgetSessionResult> {
  const chatQuota = await checkQuota(args.businessId, "chats");
  if (!chatQuota.allowed) {
    return { error: "This business has reached its monthly chat session limit. Please contact them directly.", status: 429 };
  }

  // Record the chat start as a touchpoint. Anonymous visitors don't get a
  // Contact yet; it's created once they leave an email/phone.
  const inbound = await captureInbound({
    businessId: args.businessId,
    kind: "chat_start",
    visitorId: args.visitorId,
    attribution: args.attribution,
    profile: args.profile,
    createContact: "identified",
  });

  // Only credit a rule this tenant owns; anything else is ignored, never an error.
  const rule = args.ruleId
    ? await db.widgetRule.findFirst({ where: { id: args.ruleId, businessId: args.businessId }, select: { id: true } })
    : null;

  const session = await db.chatSession.create({
    data: {
      businessId: args.businessId,
      agentId: args.agentId,
      contactId: inbound?.contactId ?? null,
      visitorId: args.visitorId ?? null,
      visitorName: args.profile.name || null,
      visitorEmail: args.profile.email || null,
      visitorPhone: args.profile.phone || null,
      status: "active",
      widgetRuleId: rule?.id ?? null,
      // The page the chat started on, shown in Conversations.
      ...(args.page ? { threadMeta: { page: { url: args.page.url, title: args.page.title } } } : {}),
    },
  });

  if (rule) {
    await db.widgetRule.update({ where: { id: rule.id }, data: { chats: { increment: 1 } } }).catch((e) => {
      logger.warn("Proactive message chat count failed", { businessId: args.businessId, ...serializeError(e) });
    });
  }
  return { session };
}

/** A new lead came from this chat: credit the proactive message that started it. */
export async function creditRuleLead(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  try {
    const s = await db.chatSession.findUnique({ where: { id: sessionId }, select: { widgetRuleId: true, businessId: true } });
    if (s?.widgetRuleId) {
      await db.widgetRule.updateMany({ where: { id: s.widgetRuleId, businessId: s.businessId }, data: { leads: { increment: 1 } } });
    }
  } catch (e) {
    logger.warn("Proactive message lead count failed", { sessionId, ...serializeError(e) });
  }
}
