import type { OAuthConnection, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptApiKey } from "@/lib/crypto";
import { createNotification } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { getConnectionProvider } from "./registry";
import { decryptToken } from "./store";
import { OAuthGrantError, type ConnectionStatus } from "./types";

/** Refresh when the access token has less than this long left. */
export const REFRESH_SKEW_MS = 5 * 60_000;

/** The connection can't be used until the tenant reconnects it. */
export class ConnectionUnavailableError extends Error {
  constructor(public readonly connectionId: string, public readonly status: string) {
    super(`Connection ${connectionId} is ${status}; reconnect it in Integrations.`);
    this.name = "ConnectionUnavailableError";
  }
}

export function needsRefresh(expiresAt: Date | null, now = Date.now(), skewMs = REFRESH_SKEW_MS): boolean {
  return expiresAt !== null && expiresAt.getTime() - now < skewMs;
}

/**
 * Move a connection out of `active` and tell the tenant's admins once.
 * Idempotent: only the transition from active notifies.
 */
export async function markConnectionFailed(
  row: Pick<OAuthConnection, "id" | "businessId" | "provider" | "accountName">,
  status: Exclude<ConnectionStatus, "active">,
  message: string
): Promise<void> {
  const res = await db.oAuthConnection.updateMany({
    where: { id: row.id, status: "active" },
    data: { status, lastError: message.slice(0, 2000) },
  });
  if (res.count === 0) return;

  const label = getConnectionProvider(row.provider)?.label ?? row.provider;
  logger.warn("OAuth connection disabled", { connectionId: row.id, provider: row.provider, status });
  await createNotification({
    businessId: row.businessId,
    type: "integration_error",
    title: `${label} connection needs attention`,
    message: `${row.accountName ?? "Your account"} was disconnected (${status}). Reconnect it in Integrations to keep it working.`,
    data: { connectionId: row.id, provider: row.provider },
  });
}

/**
 * Refresh one connection's access token. On a rejected grant the connection
 * is marked revoked and the tenant notified; transient provider errors are
 * re-thrown so the caller (a job) can retry.
 *
 * Returns the fresh access token, or null if another process refreshed it
 * first (the caller should re-read the row).
 */
export async function refreshConnection(row: OAuthConnection): Promise<string | null> {
  const provider = getConnectionProvider(row.provider);
  const refreshToken = decryptToken(row.refreshToken);
  if (!provider?.refresh || !refreshToken) return null;

  try {
    const tokens = await provider.refresh({ refreshToken, env: process.env });
    // Optimistic concurrency: only write if nobody else updated the row meanwhile.
    const res = await db.oAuthConnection.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: {
        accessToken: encryptApiKey(tokens.accessToken) as unknown as Prisma.InputJsonValue,
        ...(tokens.refreshToken && tokens.refreshToken !== refreshToken
          ? { refreshToken: encryptApiKey(tokens.refreshToken) as unknown as Prisma.InputJsonValue }
          : {}),
        expiresAt: tokens.expiresAt,
        ...(tokens.scopes.length ? { scopes: tokens.scopes.join(" ") } : {}),
        lastRefreshedAt: new Date(),
        lastError: null,
      },
    });
    return res.count === 1 ? tokens.accessToken : null;
  } catch (e) {
    if (e instanceof OAuthGrantError) {
      await markConnectionFailed(row, "revoked", `Refresh rejected by provider: ${e.message}`);
    }
    throw e;
  }
}

/**
 * Decrypted access token for a tenant's connection, refreshed first if it
 * is about to expire. Scoped by businessId so one tenant can never use
 * another's connection.
 */
export async function getAccessToken(connectionId: string, businessId: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.oAuthConnection.findFirst({ where: { id: connectionId, businessId } });
    if (!row) throw new ConnectionUnavailableError(connectionId, "missing");
    if (row.status !== "active") throw new ConnectionUnavailableError(connectionId, row.status);

    if (needsRefresh(row.expiresAt)) {
      const provider = getConnectionProvider(row.provider);
      if (!provider?.refresh || !row.refreshToken) {
        if (row.expiresAt!.getTime() <= Date.now()) {
          await markConnectionFailed(row, "expired", "Access token expired and cannot be refreshed.");
          throw new ConnectionUnavailableError(connectionId, "expired");
        }
        // Still valid for a few minutes and not refreshable: use it.
      } else {
        const fresh = await refreshConnection(row);
        if (fresh) return fresh;
        continue; // lost the race; re-read the winner's token
      }
    }

    const token = decryptToken(row.accessToken);
    if (!token) throw new ConnectionUnavailableError(connectionId, "undecryptable");
    return token;
  }
  throw new Error(`Could not obtain a fresh token for connection ${connectionId}`);
}
