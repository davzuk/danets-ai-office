import { z } from "zod";
import { db } from "@/lib/db";
import { OAuthGrantError } from "@/lib/connections/types";
import { socialAccountToken } from "@/lib/social/accounts";
import { subscribePage } from "@/lib/social/meta-graph";
import { defineJob, NonRetryableError } from "../define";

/** Subscribe a connected Facebook Page to our webhooks. IG events arrive via the app-level subscription. */
export const socialSubscribeJob = defineJob({
  type: "social.subscribe",
  schema: z.object({ socialAccountId: z.string() }),
  maxAttempts: 5,
  async handler({ socialAccountId }) {
    const row = await db.socialAccount.findUnique({ where: { id: socialAccountId } });
    if (!row || row.status !== "active" || row.platform !== "facebook_page") return;
    const token = socialAccountToken(row);
    if (!token) {
      await db.socialAccount.update({ where: { id: row.id }, data: { status: "error", lastError: "Missing page token; reconnect Meta." } });
      throw new NonRetryableError("Page has no access token");
    }
    try {
      await subscribePage(row.externalId, token);
    } catch (e) {
      if (e instanceof OAuthGrantError) {
        await db.socialAccount.update({
          where: { id: row.id },
          data: { status: "error", lastError: `Webhook subscription rejected: ${e.message}`.slice(0, 2000) },
        });
        throw new NonRetryableError(e.message);
      }
      throw e;
    }
    await db.socialAccount.update({ where: { id: row.id }, data: { subscribedAt: new Date(), lastError: null } });
  },
});
