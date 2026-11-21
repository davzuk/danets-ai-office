// Social inbox jobs fanned out from webhooks.meta. Each carries the
// SocialAccount that owns the event, so handlers are tenant-scoped.
// (meta.leadgen lives in ./meta-leadgen.)

import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingestComment, ingestDirectMessage } from "@/lib/social/inbox";
import { handleInboundSocial } from "@/lib/social/inbox-reply";
import { defineJob } from "../define";

async function inboxAccount(socialAccountId: string) {
  const acct = await db.socialAccount.findUnique({ where: { id: socialAccountId } });
  return acct && acct.status === "active" && acct.inboxEnabled ? acct : null;
}

export const metaMessageJob = defineJob({
  type: "meta.message",
  schema: z.object({
    socialAccountId: z.string(),
    platform: z.string(),
    mid: z.string(),
    senderId: z.string(),
    recipientId: z.string(),
    timestamp: z.number().nullable(),
    isEcho: z.boolean(),
    raw: z.record(z.string(), z.unknown()),
  }),
  maxAttempts: 5,
  async handler(p) {
    const acct = await inboxAccount(p.socialAccountId);
    if (!acct) return;
    const ingest = await ingestDirectMessage(acct, p);
    if (!ingest) return; // duplicate or our own echo
    if (p.isEcho) return; // a reply typed in Meta's inbox: stored, nothing to answer
    const outcome = await handleInboundSocial(acct, ingest);
    logger.info("Social message handled", { socialAccountId: acct.id, sessionId: ingest.session.id, outcome });
  },
});

export const metaCommentJob = defineJob({
  type: "meta.comment",
  schema: z.object({
    socialAccountId: z.string(),
    platform: z.string(),
    commentId: z.string(),
    verb: z.string(),
    raw: z.record(z.string(), z.unknown()),
  }),
  maxAttempts: 5,
  async handler(p) {
    const acct = await inboxAccount(p.socialAccountId);
    if (!acct) return;
    const ingest = await ingestComment(acct, p.commentId, p.verb, p.raw);
    if (!ingest || ingest.message.role !== "user") return;
    const outcome = await handleInboundSocial(acct, ingest);
    logger.info("Social comment handled", { socialAccountId: acct.id, sessionId: ingest.session.id, outcome });
  },
});
