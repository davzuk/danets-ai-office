import { z } from "zod";
import { logger } from "@/lib/logger";
import { defineJob } from "../define";

// Meta webhook delivery: { object: "page" | "instagram" | …, entry: [...] }
const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z
        .object({
          id: z.string().optional(),
          time: z.number().optional(),
          changes: z.array(z.object({ field: z.string(), value: z.unknown() }).loose()).optional(),
          messaging: z.array(z.unknown()).optional(),
        })
        .loose()
    )
    .default([]),
});

/**
 * Process one verified Meta webhook delivery.
 *
 * Phase 0 only records what arrived. Phase 1 adds the routing: `leadgen`
 * changes -> fetch the lead and create a Lead; `messaging` -> social inbox.
 */
export const metaWebhookJob = defineJob({
  type: "webhooks.meta",
  schema: metaWebhookSchema,
  async handler(payload) {
    const fields = payload.entry.flatMap((e) => [
      ...(e.changes ?? []).map((c) => c.field),
      ...(e.messaging?.length ? ["messaging"] : []),
    ]);
    logger.info("Meta webhook received", {
      object: payload.object,
      entries: payload.entry.length,
      fields: [...new Set(fields)],
    });
  },
});
