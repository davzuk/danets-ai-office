import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { logger, serializeError } from "@/lib/logger";
import { getConnectionProvider } from "@/lib/connections/registry";
import { markConnectionFailed, refreshConnection } from "@/lib/connections/tokens";
import { OAuthGrantError } from "@/lib/connections/types";
import { defineJob } from "../define";
import { enqueue } from "../queue";

const DAY = 24 * 60 * 60_000;

/** Tell a tenant their non-refreshable connection (Meta) expires soon. Enqueued once per expiry date. */
export const connectionExpiringJob = defineJob({
  type: "connections.notify-expiring",
  schema: z.object({ connectionId: z.string() }),
  maxAttempts: 3,
  async handler({ connectionId }) {
    const row = await db.oAuthConnection.findUnique({ where: { id: connectionId } });
    if (!row || row.status !== "active" || !row.expiresAt) return;
    const label = getConnectionProvider(row.provider)?.label ?? row.provider;
    const days = Math.max(0, Math.ceil((row.expiresAt.getTime() - Date.now()) / DAY));
    await createNotification({
      businessId: row.businessId,
      type: "integration_warning",
      title: `Reconnect ${label} soon`,
      message: `${row.accountName ?? "Your account"} stops syncing in ${days} day${days === 1 ? "" : "s"}. Reconnect it in Integrations to keep it working.`,
      data: { connectionId: row.id, provider: row.provider },
    });
  },
});

/**
 * Hourly: refresh tokens that expire within the next hour, expire dead
 * non-refreshable connections, and warn about ones expiring within 7 days.
 */
export const connectionRefreshJob = defineJob({
  type: "connections.refresh",
  schema: z.object({}),
  timeoutMs: 10 * 60_000,
  async handler(_payload, ctx) {
    const now = Date.now();

    const refreshable = await db.oAuthConnection.findMany({
      where: { status: "active", refreshToken: { not: Prisma.DbNull }, expiresAt: { lt: new Date(now + 60 * 60_000) } },
      take: 500,
    });
    let refreshed = 0;
    let transientFailures = 0;
    for (const row of refreshable) {
      if (ctx.signal.aborted) break;
      try {
        if (await refreshConnection(row)) refreshed++;
      } catch (e) {
        // Grant errors already marked the row revoked + notified the tenant.
        if (!(e instanceof OAuthGrantError)) {
          transientFailures++;
          logger.warn("Token refresh failed; will retry", { connectionId: row.id, ...serializeError(e) });
        }
      }
    }

    const nonRefreshable = await db.oAuthConnection.findMany({
      where: { status: "active", refreshToken: { equals: Prisma.DbNull }, expiresAt: { lt: new Date(now + 7 * DAY) } },
      take: 500,
    });
    let expired = 0;
    for (const row of nonRefreshable) {
      if (row.expiresAt!.getTime() <= now) {
        await markConnectionFailed(row, "expired", "Access token expired. Reconnect to restore access.");
        expired++;
      } else {
        await enqueue(
          connectionExpiringJob,
          { connectionId: row.id },
          { businessId: row.businessId, dedupeKey: `conn-expiring:${row.id}:${row.expiresAt!.toISOString()}` }
        );
      }
    }

    logger.info("Connection refresh pass", { refreshed, transientFailures, expired, checked: refreshable.length + nonRefreshable.length });
    // Fail the run so the queue retries with backoff; refresh is idempotent.
    if (transientFailures > 0) throw new Error(`${transientFailures} connection refresh(es) failed transiently`);
  },
});
