// Sending from the social inbox (team replies, AI auto-replies, drafts) and
// turning threads into leads.

import type { AiAgent, ChatMessage, ChatSession, Lead, SocialAccount } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";
import { logUsage } from "@/lib/ai";
import { aiStructured } from "@/lib/llm";
import { contactTouchBounds, resolveContact, type IdentityInput } from "@/lib/contacts";
import { generateAgentReply, type ReplyChannel } from "@/lib/agent-reply";
import { logger, serializeError } from "@/lib/logger";
import { checkMonthlyAiQuota } from "@/lib/plan-limits";
import { requireQuota } from "@/lib/plan-quota";
import type { SocialPlatform } from "@/lib/connections/types";
import { socialAccountToken } from "./accounts";
import { replyToComment, sendPageMessage, setCommentHidden } from "./meta-graph";
import {
  HUMAN_QUIET_MS,
  extractContactDetails,
  isCommentChannel,
  messageWindow,
  notifyInbox,
  withAiDisclosure,
  type IngestResult,
} from "./inbox";

type InboxErrorCode = "window_closed" | "account_unavailable" | "not_social" | "provider" | "empty";
const INBOX_ERROR_STATUS: Record<InboxErrorCode, number> = {
  window_closed: 409,
  account_unavailable: 409,
  not_social: 400,
  empty: 400,
  provider: 502,
};

/** Send/inbox failure; an AppError so API routes return the right status. */
export class InboxSendError extends AppError {
  readonly reason: InboxErrorCode;
  constructor(message: string, reason: InboxErrorCode) {
    super(message, { status: INBOX_ERROR_STATUS[reason], code: `INBOX_${reason.toUpperCase()}` });
    this.reason = reason;
  }
}

type SessionWithAccount = ChatSession & { socialAccount: SocialAccount | null };

async function loadThread(sessionId: string, businessId: string): Promise<SessionWithAccount> {
  const s = await db.chatSession.findFirst({ where: { id: sessionId, businessId }, include: { socialAccount: true } });
  if (!s || !s.socialAccount || s.channel === "widget") throw new InboxSendError("Not a social conversation", "not_social");
  return s;
}

function usableToken(acct: SocialAccount): string {
  const token = acct.status === "active" ? socialAccountToken(acct) : null;
  if (!token) throw new InboxSendError(`${acct.name} is disconnected. Reconnect Meta in Integrations.`, "account_unavailable");
  return token;
}

function threadUserId(s: ChatSession) {
  return s.externalThreadId?.startsWith("u:") ? s.externalThreadId.slice(2) : null;
}

export interface SendArgs {
  sessionId: string;
  businessId: string;
  text: string;
  /** Team member sending; omit for the AI. */
  userId?: string | null;
  /** Comments only: "private" sends a DM to the commenter instead of a public reply. */
  mode?: "reply" | "private";
  tokensUsed?: number;
}

/**
 * Send a reply on a social thread and store it. Enforces Meta's messaging
 * window for DMs. Failed sends are stored (deliveryStatus "failed") so the
 * team can see them, then re-thrown.
 */
export async function sendSocialReply(args: SendArgs): Promise<ChatMessage> {
  const text = args.text.trim();
  if (!text) throw new InboxSendError("Message is empty", "empty");
  const session = await loadThread(args.sessionId, args.businessId);
  const acct = session.socialAccount!;
  const token = usableToken(acct);
  const platform = acct.platform as SocialPlatform;
  const isHuman = !!args.userId;

  let send: () => Promise<string>;
  let meta: Record<string, unknown> = {};
  if (isCommentChannel(session.channel)) {
    const target = await db.chatMessage.findFirst({
      where: { sessionId: session.id, role: "user", externalId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { externalId: true },
    });
    const commentId = target?.externalId;
    if (!commentId) throw new InboxSendError("No comment to reply to", "not_social");
    if (args.mode === "private") {
      meta = { privateReply: true, commentId };
      send = async () => (await sendPageMessage(token, { comment_id: commentId }, text)).message_id;
    } else {
      meta = { commentId };
      send = async () => (await replyToComment(commentId, token, text, platform === "instagram" ? "instagram" : "facebook_page")).id;
    }
  } else {
    const userId = threadUserId(session);
    if (!userId) throw new InboxSendError("Thread has no recipient", "not_social");
    const win = messageWindow(session.lastInboundAt);
    if (win.state === "closed" || (win.state === "human_agent" && !isHuman)) {
      throw new InboxSendError(
        win.state === "closed"
          ? "Meta only allows replies within 7 days of the customer's last message. Wait for them to write again."
          : "More than 24 hours have passed: only a person on your team can reply now (up to 7 days).",
        "window_closed"
      );
    }
    send = async () =>
      (await sendPageMessage(token, { id: userId }, text, win.state === "human_agent" ? { tag: "HUMAN_AGENT" } : {})).message_id;
  }

  try {
    const externalId = await send();
    const [message] = await db.$transaction([
      db.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content: text,
          externalId,
          deliveryStatus: "sent",
          sentByUserId: args.userId ?? null,
          tokensUsed: args.tokensUsed ?? 0,
          meta: JSON.stringify(meta),
        },
      }),
      db.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } }),
    ]);
    return message;
  } catch (e) {
    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: text,
        deliveryStatus: "failed",
        sentByUserId: args.userId ?? null,
        meta: JSON.stringify({ ...meta, error: (e as Error).message?.slice(0, 500) }),
      },
    });
    throw e instanceof InboxSendError ? e : new InboxSendError(`Meta rejected the message: ${(e as Error).message}`, "provider");
  }
}

/** Hide or unhide the latest comment in a comment thread. */
export async function hideThreadComment(sessionId: string, businessId: string, messageId: string, hidden: boolean) {
  const session = await loadThread(sessionId, businessId);
  if (!isCommentChannel(session.channel)) throw new InboxSendError("Only comments can be hidden", "not_social");
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, sessionId: session.id, role: "user" } });
  if (!msg?.externalId) throw new InboxSendError("Comment not found", "not_social");
  const acct = session.socialAccount!;
  await setCommentHidden(msg.externalId, usableToken(acct), hidden, acct.platform === "instagram" ? "instagram" : "facebook_page");
  const meta = { ...safeJson(msg.meta), hidden };
  return db.chatMessage.update({ where: { id: msg.id }, data: { meta: JSON.stringify(meta) } });
}

function safeJson(s: string | null): Record<string, unknown> {
  try {
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// ─── Comment classification ────────────────────────────────────────────

export const COMMENT_LABELS = ["buying_intent", "question", "complaint", "spam", "other"] as const;
export type CommentLabel = (typeof COMMENT_LABELS)[number];
const classificationSchema = z.object({ label: z.enum(COMMENT_LABELS) });

export async function classifyComment(businessId: string, text: string): Promise<CommentLabel | null> {
  try {
    const res = await aiStructured(
      [
        {
          role: "system",
          content:
            "Classify a public social media comment left on a business's post. Labels: buying_intent (wants to buy, asks price/availability/booking), question (asks something else), complaint (unhappy customer), spam (scam, unrelated promotion, bots, abuse), other (praise, tags, emojis, chit-chat). Reply with JSON only.",
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
      classificationSchema,
      { businessId, task: "classify", temperature: 0 }
    );
    await logUsage(businessId, "classify", res);
    return res.data.label;
  } catch (e) {
    logger.warn("Comment classification failed", { businessId, ...serializeError(e) });
    return null;
  }
}

// ─── Auto-reply ────────────────────────────────────────────────────────

async function humanRepliedRecently(sessionId: string, now = Date.now()) {
  const recent = await db.chatMessage.findFirst({
    where: {
      sessionId,
      role: "assistant",
      createdAt: { gt: new Date(now - HUMAN_QUIET_MS) },
      OR: [{ sentByUserId: { not: null } }, { meta: { contains: '"source":"meta_inbox"' } }],
    },
    select: { id: true },
  });
  return !!recent;
}

export type AutoReplyOutcome =
  | "sent"
  | "drafted"
  | "handover"
  | "notified"
  | "skipped_spam"
  | "skipped_paused"
  | "skipped_human"
  | "skipped_quota"
  | "skipped_no_agent"
  | "failed";

/**
 * Decide what the AI does with a new inbound social message, per the
 * account's mode: off (notify), draft (store a suggested reply), auto (send).
 */
export async function handleInboundSocial(
  account: SocialAccount,
  ingest: IngestResult
): Promise<AutoReplyOutcome> {
  let { session } = ingest;
  const { message } = ingest;
  const comment = isCommentChannel(session.channel);
  const mode = account.autoReply;

  // Typed contact details in a private message = a lead, whatever the mode.
  if (!comment) await maybeCaptureLead(session, message).catch((e) => logger.warn("Social lead capture failed", serializeError(e)));

  const notifyIfIdle = async (reason: string) => {
    const idle = !ingest.previousInboundAt || Date.now() - ingest.previousInboundAt.getTime() > HUMAN_QUIET_MS;
    if (ingest.newThread || idle) await notifyInbox(session, account, reason);
    return "notified" as const;
  };

  if (mode === "off") return notifyIfIdle(comment ? "New comment" : "New message");
  if (session.autoReplyPaused || session.status === "handover") {
    await notifyInbox(session, account, "New message in a conversation your team took over");
    return "skipped_paused";
  }
  if (await humanRepliedRecently(session.id)) return "skipped_human";

  const quota = await checkMonthlyAiQuota(session.businessId);
  if (!quota.allowed) {
    await notifyIfIdle("New message (AI quota used up, reply manually)");
    return "skipped_quota";
  }

  if (comment) {
    const label = await classifyComment(session.businessId, message.content);
    if (label) {
      await db.chatMessage.update({
        where: { id: message.id },
        data: { meta: JSON.stringify({ ...safeJson(message.meta), classification: label }) },
      });
    }
    if (label === "spam") return "skipped_spam";
    if (label === "complaint") {
      await notifyInbox(session, account, "Complaint in a comment: needs a person");
      return "notified";
    }
    if (label === "other") return "notified"; // praise and chit-chat don't need an answer
  }

  const agent = session.agentId ? await db.aiAgent.findFirst({ where: { id: session.agentId, status: "active" } }) : null;
  if (!agent) {
    await notifyIfIdle("New message (no active AI agent)");
    return "skipped_no_agent";
  }
  const business = await db.business.findUnique({ where: { id: session.businessId }, select: { id: true, name: true } });
  if (!business) return "failed";

  const reply = await generateAgentReply({
    business,
    agent,
    sessionId: session.id,
    message: message.content,
    channel: session.channel as ReplyChannel,
  });
  if (reply.failed) {
    await notifyIfIdle("New message (AI reply failed, reply manually)");
    return "failed";
  }

  if (reply.handoverRequested && !comment) {
    session = await db.chatSession.update({ where: { id: session.id }, data: { status: "handover", autoReplyPaused: true } });
    await notifyInbox(session, account, "Customer asked for a person");
    if (mode === "auto") await sendAi(session, agent, agent.handoverMessage, reply.usage.totalTokens);
    await logUsage(session.businessId, "chat", reply.usage);
    return "handover";
  }

  if (mode === "draft") {
    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: reply.content,
        deliveryStatus: "draft",
        tokensUsed: reply.usage.totalTokens,
        meta: JSON.stringify({ kbUsed: reply.kbIds }),
      },
    });
    await logUsage(session.businessId, "chat", reply.usage);
    await notifyIfIdle("AI drafted a reply for you to review");
    return "drafted";
  }

  await logUsage(session.businessId, "chat", reply.usage);
  return (await sendAi(session, agent, reply.content, reply.usage.totalTokens)) ? "sent" : "failed";
}

async function sendAi(session: ChatSession, agent: Pick<AiAgent, "id">, text: string, tokens: number) {
  const priorAi = await db.chatMessage.count({
    where: { sessionId: session.id, role: "assistant", sentByUserId: null, deliveryStatus: "sent" },
  });
  try {
    await sendSocialReply({
      sessionId: session.id,
      businessId: session.businessId,
      text: withAiDisclosure(text, priorAi === 0),
      tokensUsed: tokens,
    });
    return true;
  } catch (e) {
    logger.warn("AI social reply not sent", { sessionId: session.id, agentId: agent.id, ...serializeError(e) });
    return false;
  }
}

// ─── Leads from threads ────────────────────────────────────────────────

async function maybeCaptureLead(session: ChatSession, message: ChatMessage) {
  if (message.role !== "user") return;
  const { email, phone } = extractContactDetails(message.content);
  if (!email && !phone) return;
  await createLeadFromThread(session.id, session.businessId, { email, phone });
}

/**
 * Create (or enrich) the lead for a social thread. Used when someone types
 * their email/phone in a DM and by the "Create lead" button.
 */
export async function createLeadFromThread(
  sessionId: string,
  businessId: string,
  details: { name?: string | null; email?: string | null; phone?: string | null },
  actor?: { userId: string; name: string }
): Promise<{ lead: Lead; created: boolean }> {
  const session = await db.chatSession.findFirst({ where: { id: sessionId, businessId }, include: { lead: true, socialAccount: true } });
  if (!session) throw new InboxSendError("Conversation not found", "not_social");
  const email = details.email?.trim().toLowerCase() || null;
  const phone = details.phone?.trim() || null;
  const name = details.name?.trim() || session.visitorName || email || phone || "Social contact";

  // Merge the typed details into the thread's contact.
  const identities: IdentityInput[] = [];
  const userId = threadUserId(session);
  if (userId) identities.push({ type: session.socialAccount?.platform === "instagram" ? "ig_id" : "fb_psid", value: userId });
  const resolved = await resolveContact({ businessId, identities, profile: { name, email, phone } }).catch(() => null);
  const contactId = resolved?.contact.id ?? session.contactId;
  if (contactId && contactId !== session.contactId) {
    await db.chatSession.update({ where: { id: session.id }, data: { contactId } });
  }
  await db.chatSession.update({
    where: { id: session.id },
    data: { visitorEmail: session.visitorEmail ?? email, visitorPhone: session.visitorPhone ?? phone },
  });

  const existing =
    session.lead ??
    (email ? await db.lead.findUnique({ where: { Lead_businessId_email_key: { businessId, email } } }) : null);
  if (existing) {
    const lead = await db.lead.update({
      where: { id: existing.id },
      data: { phone: existing.phone ?? phone, email: existing.email ?? email, contactId: existing.contactId ?? contactId },
    });
    return { lead, created: false };
  }

  await requireQuota(businessId, "leads");
  const first = contactId ? (await contactTouchBounds(contactId)).first : null;
  const lead = await db.lead.create({
    data: {
      businessId,
      sessionId: session.id,
      name: name.slice(0, 191),
      email,
      phone,
      quality: email && phone ? "high" : "medium",
      status: "new",
      source: first?.channel ?? "social_organic",
      contactId,
      firstTouchId: first?.id ?? null,
      message: `From a ${channelLabel(session.channel)} conversation`,
    },
  });
  await db.leadActivity.create({
    data: {
      leadId: lead.id,
      businessId,
      type: "lead_created",
      description: `Created from a ${channelLabel(session.channel)} conversation${actor ? ` by ${actor.name}` : ""}`,
      actorId: actor?.userId ?? null,
      actorName: actor?.name ?? null,
    },
  });
  await createNotification({
    businessId,
    type: "new_lead",
    title: `New lead from ${channelLabel(session.channel)}`,
    message: `${lead.name}${email ? ` (${email})` : phone ? ` (${phone})` : ""}`,
    data: { leadId: lead.id, source: lead.source },
  });
  await fireTrigger("new_lead", { businessId, leadId: lead.id, leadName: lead.name });
  import("@/lib/ai-scoring")
    .then(({ scoreLead }) => scoreLead(lead.id, businessId))
    .catch(() => {});
  return { lead, created: true };
}

function channelLabel(channel: string) {
  return (
    { messenger: "Messenger", instagram_dm: "Instagram", facebook_comment: "Facebook comment", instagram_comment: "Instagram comment" }[
      channel
    ] ?? "social"
  );
}
