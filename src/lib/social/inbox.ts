// Social inbox: Messenger / Instagram DMs and Page / IG comments stored as
// ChatSessions so Conversations, summaries, lead linking and retention keep
// working. Thread keys: "u:<PSID|IGSID>" for DMs, "c:<root comment id>" for
// comment threads (unique per SocialAccount).

import type { ChatMessage, ChatSession, Prisma, SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { recordTouch } from "@/lib/attribution";
import { normalizeEmail, normalizePhone, resolveContact, type IdentityInput } from "@/lib/contacts";
import { logger, serializeError } from "@/lib/logger";
import type { SocialPlatform } from "@/lib/connections/types";
import { fetchMessagingProfile } from "./meta-graph";
import { socialAccountToken } from "./accounts";

export type InboxChannel = "messenger" | "instagram_dm" | "facebook_comment" | "instagram_comment";
export const SOCIAL_CHANNELS: InboxChannel[] = ["messenger", "instagram_dm", "facebook_comment", "instagram_comment"];

const HOUR = 60 * 60_000;
export const STANDARD_WINDOW_MS = 24 * HOUR;
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * HOUR;
/** The AI stays quiet this long after a person on the team replied. */
export const HUMAN_QUIET_MS = 30 * 60_000;

export const dmThreadKey = (userId: string) => `u:${userId}`;
export const commentThreadKey = (rootCommentId: string) => `c:${rootCommentId}`;

export function dmChannel(platform: SocialPlatform): InboxChannel {
  return platform === "instagram" ? "instagram_dm" : "messenger";
}
export function commentChannel(platform: SocialPlatform): InboxChannel {
  return platform === "instagram" ? "instagram_comment" : "facebook_comment";
}
export const isCommentChannel = (c: string) => c === "facebook_comment" || c === "instagram_comment";

export type WindowState = "open" | "human_agent" | "closed";

/**
 * Meta's messaging window: anyone may reply within 24 hours of the person's
 * last message; a human may reply with the HUMAN_AGENT tag for 7 days;
 * after that nobody can until they write again.
 */
export function messageWindow(lastInboundAt: Date | null | undefined, now: Date = new Date()) {
  if (!lastInboundAt) return { state: "closed" as WindowState, closesAt: null };
  const age = now.getTime() - lastInboundAt.getTime();
  if (age < STANDARD_WINDOW_MS) return { state: "open" as WindowState, closesAt: new Date(lastInboundAt.getTime() + STANDARD_WINDOW_MS) };
  if (age < HUMAN_AGENT_WINDOW_MS) return { state: "human_agent" as WindowState, closesAt: new Date(lastInboundAt.getTime() + HUMAN_AGENT_WINDOW_MS) };
  return { state: "closed" as WindowState, closesAt: null };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/** Text of a Messenger / IG messaging event; attachments and postbacks get a placeholder. */
export function messagingText(raw: Obj): string {
  const message = isObj(raw.message) ? raw.message : null;
  if (message) {
    const text = str(message.text);
    if (text) return text;
    const atts = Array.isArray(message.attachments) ? message.attachments : [];
    if (atts.length) return atts.map((a) => `[${isObj(a) ? str(a.type) ?? "attachment" : "attachment"}]`).join(" ");
    return "[message]";
  }
  const postback = isObj(raw.postback) ? raw.postback : null;
  if (postback) return str(postback.title) ?? str(postback.payload) ?? "[button]";
  return "[message]";
}

export interface CommentInfo {
  text: string;
  authorId: string | null;
  authorName: string | null;
  /** Top-level comment of the thread. */
  rootId: string;
  postId: string | null;
  mediaId: string | null;
  createdAt: Date | null;
}

/** Normalise Facebook `feed` and Instagram `comments` webhook values. */
export function parseComment(platform: SocialPlatform, commentId: string, raw: Obj): CommentInfo {
  const from = isObj(raw.from) ? raw.from : {};
  if (platform === "instagram") {
    const media = isObj(raw.media) ? raw.media : {};
    return {
      text: str(raw.text) ?? "",
      authorId: str(from.id),
      authorName: str(from.username),
      rootId: str(raw.parent_id) ?? commentId,
      postId: null,
      mediaId: str(media.id),
      createdAt: null,
    };
  }
  const postId = str(raw.post_id);
  const parent = str(raw.parent_id);
  const created = typeof raw.created_time === "number" ? new Date(raw.created_time * 1000) : null;
  return {
    text: str(raw.message) ?? "",
    authorId: str(from.id),
    authorName: str(from.name),
    // Facebook sets parent_id to the post for top-level comments.
    rootId: parent && parent !== postId ? parent : commentId,
    postId,
    mediaId: null,
    createdAt: created,
  };
}

const EMAIL_IN_TEXT = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const PHONE_IN_TEXT = /(?:\+|00)?\d[\d\s().-]{6,18}\d/;

/** Email / phone someone typed into a message. */
export function extractContactDetails(text: string): { email: string | null; phone: string | null } {
  const email = normalizeEmail(text.match(EMAIL_IN_TEXT)?.[0]);
  const phoneRaw = text.match(PHONE_IN_TEXT)?.[0];
  return { email, phone: phoneRaw && normalizePhone(phoneRaw) ? phoneRaw.trim() : null };
}

/** Meta's platform policy (and ours): AI replies say they're from an AI. */
export function withAiDisclosure(text: string, firstAiReply: boolean): string {
  if (!firstAiReply || /\b(AI|artificial intelligence|virtual assistant|automated)\b/i.test(text)) return text;
  return `(AI assistant) ${text}`;
}

// ─── Ingest ────────────────────────────────────────────────────────────

type Account = Pick<SocialAccount, "id" | "businessId" | "platform" | "externalId" | "name" | "accessToken">;

export interface IngestResult {
  session: ChatSession;
  message: ChatMessage;
  newThread: boolean;
  /** lastInboundAt before this message (null for a new thread). */
  previousInboundAt: Date | null;
}

async function findOrCreateThread(args: {
  account: Account;
  channel: InboxChannel;
  threadKey: string;
  visitorName: string | null;
  threadMeta?: Obj;
  inbound: boolean;
}): Promise<{ session: ChatSession; created: boolean }> {
  const where = { socialAccountId_externalThreadId: { socialAccountId: args.account.id, externalThreadId: args.threadKey } };
  const existing = await db.chatSession.findUnique({ where });
  if (existing) return { session: existing, created: false };

  const agent = await db.aiAgent.findFirst({ where: { businessId: args.account.businessId, status: "active" }, select: { id: true } });
  try {
    const session = await db.chatSession.create({
      data: {
        businessId: args.account.businessId,
        agentId: agent?.id ?? null,
        channel: args.channel,
        socialAccountId: args.account.id,
        externalThreadId: args.threadKey,
        visitorName: args.visitorName,
        threadMeta: (args.threadMeta ?? undefined) as Prisma.InputJsonValue | undefined,
        status: "active",
      },
    });
    return { session, created: true };
  } catch (e) {
    // Two deliveries for a new thread raced; use the winner.
    if ((e as { code?: string })?.code === "P2002") {
      const winner = await db.chatSession.findUnique({ where });
      if (winner) return { session: winner, created: false };
    }
    throw e;
  }
}

/** Store a message once (deduped on the Meta id). Returns null if it was already stored. */
async function storeMessage(data: Prisma.ChatMessageUncheckedCreateInput): Promise<ChatMessage | null> {
  try {
    return await db.chatMessage.create({ data });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return null;
    throw e;
  }
}

/** Link the thread to a Contact and record the social touch, once per new thread. */
async function attachContact(account: Account, session: ChatSession, identities: IdentityInput[], name: string | null) {
  try {
    const resolved = identities.length
      ? await resolveContact({ businessId: account.businessId, identities, profile: { name } })
      : null;
    const contactId = resolved?.contact.id ?? null;
    await recordTouch({
      businessId: account.businessId,
      kind: "social_dm",
      channel: "social_organic",
      touch: { source: account.platform === "instagram" ? "instagram" : "facebook", medium: isCommentChannel(session.channel) ? "comment" : "dm" },
      contactId,
      dedupeKey: `social-thread:${session.id}`,
    });
    if (contactId) {
      return db.chatSession.update({ where: { id: session.id }, data: { contactId } });
    }
  } catch (e) {
    logger.warn("Social thread contact/touch failed", { sessionId: session.id, ...serializeError(e) });
  }
  return session;
}

export interface DmEvent {
  mid: string;
  senderId: string;
  recipientId: string;
  timestamp: number | null;
  isEcho: boolean;
  raw: Obj;
}

/**
 * Store an inbound DM (or an echo of a reply the Page sent from Meta's own
 * inbox). Echoes of messages we sent through the API are already stored
 * under the same mid and are skipped.
 */
export async function ingestDirectMessage(account: Account, e: DmEvent): Promise<IngestResult | null> {
  const platform = account.platform as SocialPlatform;
  const channel = dmChannel(platform);
  const userId = e.isEcho ? e.recipientId : e.senderId;
  const at = e.timestamp ? new Date(e.timestamp) : new Date();

  if (await db.chatMessage.findUnique({ where: { externalId: e.mid }, select: { id: true } })) return null;
  // Echo of a message this app sent: stored when it was sent (the echo can beat that write).
  const echoAppId = isObj(e.raw.message) ? str(e.raw.message.app_id) : null;
  if (e.isEcho && echoAppId && echoAppId === process.env.META_APP_ID) return null;

  let name: string | null = null;
  const known = await db.chatSession.findUnique({
    where: { socialAccountId_externalThreadId: { socialAccountId: account.id, externalThreadId: dmThreadKey(userId) } },
    select: { id: true },
  });
  if (!known && !e.isEcho) {
    const token = socialAccountToken(account);
    const profile = token ? await fetchMessagingProfile(userId, token, platform === "instagram" ? "instagram" : "facebook_page") : null;
    name = profile?.name || (profile?.username ? `@${profile.username}` : null);
  }

  let { session, created } = await findOrCreateThread({ account, channel, threadKey: dmThreadKey(userId), visitorName: name, inbound: !e.isEcho });
  if (created) {
    const identity: IdentityInput = { type: platform === "instagram" ? "ig_id" : "fb_psid", value: userId };
    session = await attachContact(account, session, [identity], name);
  }

  const previousInboundAt = session.lastInboundAt;
  const text = messagingText(e.raw).slice(0, 10_000);
  const message = await storeMessage({
    sessionId: session.id,
    role: e.isEcho ? "assistant" : "user",
    content: text,
    externalId: e.mid,
    deliveryStatus: e.isEcho ? "sent" : null,
    meta: e.isEcho ? JSON.stringify({ source: "meta_inbox" }) : null,
    createdAt: at,
  });
  if (!message) return null;

  session = await db.chatSession.update({
    where: { id: session.id },
    data: e.isEcho
      ? { updatedAt: new Date() }
      : { lastInboundAt: at, updatedAt: new Date(), ...(session.status === "ended" ? { status: "active" } : {}) },
  });
  return { session, message, newThread: created, previousInboundAt: created ? null : previousInboundAt };
}

/** Store a new comment on a Page post / IG media. Our own replies are recorded as team messages. */
export async function ingestComment(
  account: Account,
  commentId: string,
  verb: string,
  raw: Obj
): Promise<IngestResult | null> {
  if (verb !== "add") return null; // edits, removals and hides are ignored for now
  const platform = account.platform as SocialPlatform;
  const info = parseComment(platform, commentId, raw);
  if (await db.chatMessage.findUnique({ where: { externalId: commentId }, select: { id: true } })) return null;

  // The Page commenting on its own post (a reply typed in Meta's UI).
  const fromPage = !!info.authorId && info.authorId === account.externalId;
  if (fromPage) {
    const thread = await db.chatSession.findUnique({
      where: { socialAccountId_externalThreadId: { socialAccountId: account.id, externalThreadId: commentThreadKey(info.rootId) } },
      select: { id: true },
    });
    if (!thread) return null; // a thread the Page started itself is not a conversation
  }
  let { session, created } = await findOrCreateThread({
    account,
    channel: commentChannel(platform),
    threadKey: commentThreadKey(info.rootId),
    visitorName: fromPage ? null : info.authorName,
    threadMeta: { postId: info.postId, mediaId: info.mediaId, rootCommentId: info.rootId },
    inbound: !fromPage,
  });
  if (created) {
    // Instagram comment author ids are IGSIDs, the same id the person has in DMs.
    const identities: IdentityInput[] = platform === "instagram" && info.authorId ? [{ type: "ig_id", value: info.authorId }] : [];
    session = await attachContact(account, session, identities, info.authorName);
  }

  const previousInboundAt = session.lastInboundAt;
  const at = info.createdAt ?? new Date();
  const message = await storeMessage({
    sessionId: session.id,
    role: fromPage ? "assistant" : "user",
    content: (info.text || "[comment]").slice(0, 10_000),
    externalId: commentId,
    deliveryStatus: fromPage ? "sent" : null,
    meta: JSON.stringify({ authorId: info.authorId, authorName: info.authorName, ...(fromPage ? { source: "meta_inbox" } : {}) }),
    createdAt: at,
  });
  if (!message) return null;

  session = await db.chatSession.update({
    where: { id: session.id },
    data: fromPage
      ? { updatedAt: new Date() }
      : {
          lastInboundAt: at,
          updatedAt: new Date(),
          ...(session.visitorName ? {} : { visitorName: info.authorName }),
          ...(session.status === "ended" ? { status: "active" } : {}),
        },
  });
  return { session, message, newThread: created, previousInboundAt: created ? null : previousInboundAt };
}

/** Notify the team about a social thread that needs a person. */
export async function notifyInbox(session: ChatSession, account: Pick<SocialAccount, "name">, reason: string) {
  const label: Record<string, string> = {
    messenger: "Messenger",
    instagram_dm: "Instagram",
    facebook_comment: "Facebook comment",
    instagram_comment: "Instagram comment",
  };
  await createNotification({
    businessId: session.businessId,
    type: "social_message",
    title: `${label[session.channel] ?? "Social"}: ${session.visitorName ?? "new conversation"}`,
    message: `${reason} (${account.name})`,
    data: { view: "conversations", sessionId: session.id },
  });
}
