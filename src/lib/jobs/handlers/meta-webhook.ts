import { z } from "zod";
import type { SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { metaEventDedupeKey, routeMetaWebhook, type MetaEvent } from "@/lib/social/meta-webhook-routing";
import { enqueue } from "../queue";
import { defineJob } from "../define";
import { metaCommentJob, metaMessageJob } from "./meta-events";
import { metaLeadgenJob } from "./meta-leadgen";

// Meta webhook delivery: { object: "page" | "instagram" | …, entry: [...] }
const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.unknown()).default([]),
});

/** Whether the tenant switched on the feature this event feeds. */
export function eventEnabled(e: MetaEvent, acct: Pick<SocialAccount, "leadSyncEnabled" | "inboxEnabled">): boolean {
  return e.kind === "leadgen" ? acct.leadSyncEnabled : acct.inboxEnabled;
}

/**
 * Process one verified Meta webhook delivery: split it into events, find
 * the tenant's SocialAccount for each, and queue one job per event. Events
 * for unknown, inactive or switched-off accounts are dropped.
 */
export const metaWebhookJob = defineJob({
  type: "webhooks.meta",
  schema: metaWebhookSchema,
  async handler(payload) {
    const { events, ignored } = routeMetaWebhook(payload);
    const accounts = new Map<string, SocialAccount | null>();
    let queued = 0;
    const dropped: Record<string, number> = {};
    const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);

    for (const e of events) {
      const k = `${e.platform}:${e.accountExternalId}`;
      if (!accounts.has(k)) {
        accounts.set(k, await db.socialAccount.findUnique({ where: { platform_externalId: { platform: e.platform, externalId: e.accountExternalId } } }));
      }
      const acct = accounts.get(k);
      if (!acct) { drop("unknown_account"); continue; }
      if (acct.status !== "active") { drop("inactive_account"); continue; }
      if (!eventEnabled(e, acct)) { drop(`${e.kind}_disabled`); continue; }

      const opts = { businessId: acct.businessId, dedupeKey: metaEventDedupeKey(e) };
      const socialAccountId = acct.id;
      if (e.kind === "leadgen") {
        const { leadgenId, formId, adId, createdTime } = e;
        await enqueue(metaLeadgenJob, { socialAccountId, leadgenId, formId, adId, createdTime }, opts);
      } else if (e.kind === "message") {
        const { platform, mid, senderId, recipientId, timestamp, isEcho, raw } = e;
        await enqueue(metaMessageJob, { socialAccountId, platform, mid, senderId, recipientId, timestamp, isEcho, raw }, opts);
      } else {
        const { platform, commentId, verb, raw } = e;
        await enqueue(metaCommentJob, { socialAccountId, platform, commentId, verb, raw }, opts);
      }
      queued++;
    }

    logger.info("Meta webhook routed", {
      object: payload.object,
      entries: payload.entry.length,
      queued,
      dropped,
      ignored: [...new Set(ignored)],
    });
  },
});
