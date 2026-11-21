// Per-event jobs fanned out from webhooks.meta. Each carries the
// SocialAccount that owns the event, so handlers are tenant-scoped.
// meta.leadgen lives in ./meta-leadgen; H fills in meta.message / meta.comment.

import { z } from "zod";
import { logger } from "@/lib/logger";
import { defineJob } from "../define";

const base = { socialAccountId: z.string() };

export const metaMessageJob = defineJob({
  type: "meta.message",
  schema: z.object({
    ...base,
    platform: z.string(),
    mid: z.string(),
    senderId: z.string(),
    recipientId: z.string(),
    timestamp: z.number().nullable(),
    isEcho: z.boolean(),
    raw: z.record(z.string(), z.unknown()),
  }),
  async handler(p) {
    logger.info("Meta message received (inbox arrives in workstream H)", { socialAccountId: p.socialAccountId, platform: p.platform, echo: p.isEcho });
  },
});

export const metaCommentJob = defineJob({
  type: "meta.comment",
  schema: z.object({
    ...base,
    platform: z.string(),
    commentId: z.string(),
    verb: z.string(),
    raw: z.record(z.string(), z.unknown()),
  }),
  async handler(p) {
    logger.info("Meta comment received (inbox arrives in workstream H)", { socialAccountId: p.socialAccountId, platform: p.platform, verb: p.verb });
  },
});
