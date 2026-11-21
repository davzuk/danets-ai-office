import type { OAuthConnection, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptApiKey, encryptApiKey } from "@/lib/crypto";
import { logger, serializeError } from "@/lib/logger";
import { getConnectionProvider } from "./registry";
import type { ConnectedAccount, ConnectionProviderId, TokenSet } from "./types";

/** Client-safe view of a connection: no tokens, no encrypted envelopes. */
export interface PublicConnection {
  id: string;
  provider: string;
  accountName: string | null;
  accountEmail: string | null;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  lastError: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
  /** e.g. Meta pages as { id, name, instagram } */
  assets: { id: string; name: string; instagram?: { id: string; username: string | null } | null }[];
}

export function toPublicConnection(row: OAuthConnection): PublicConnection {
  const meta = (row.metadata ?? {}) as { pages?: { id: string; name: string; instagram?: any }[] };
  return {
    id: row.id,
    provider: row.provider,
    accountName: row.accountName,
    accountEmail: row.accountEmail,
    scopes: row.scopes.split(" ").filter(Boolean),
    status: row.status,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastRefreshedAt: row.lastRefreshedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    assets: (meta.pages ?? []).map((p) => ({ id: p.id, name: p.name, instagram: p.instagram ?? null })),
  };
}

export async function listConnections(businessId: string): Promise<PublicConnection[]> {
  const rows = await db.oAuthConnection.findMany({
    where: { businessId },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toPublicConnection);
}

/** Insert or refresh the connection for this (business, provider, account). */
export async function saveConnection(args: {
  businessId: string;
  userId: string;
  provider: ConnectionProviderId;
  tokens: TokenSet;
  account: ConnectedAccount;
}): Promise<OAuthConnection> {
  const { businessId, userId, provider, tokens, account } = args;
  const data = {
    accountName: account.name ?? null,
    accountEmail: account.email ?? null,
    scopes: tokens.scopes.join(" "),
    accessToken: encryptApiKey(tokens.accessToken) as unknown as Prisma.InputJsonValue,
    expiresAt: tokens.expiresAt,
    status: "active",
    lastError: null,
    lastRefreshedAt: new Date(),
    metadata: (account.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    connectedById: userId,
  };
  const refresh = tokens.refreshToken
    ? { refreshToken: encryptApiKey(tokens.refreshToken) as unknown as Prisma.InputJsonValue }
    : {};

  return db.oAuthConnection.upsert({
    where: {
      businessId_provider_externalAccountId: {
        businessId,
        provider,
        externalAccountId: account.externalAccountId,
      },
    },
    create: { businessId, provider, externalAccountId: account.externalAccountId, ...data, ...refresh },
    // Keep the stored refresh token if the provider didn't send a new one.
    update: { ...data, ...refresh },
  });
}

export function decryptToken(payload: unknown): string | null {
  return payload == null ? null : decryptApiKey(payload);
}

/** Revoke at the provider (best effort) and delete the row. */
export async function deleteConnection(row: OAuthConnection): Promise<void> {
  const provider = getConnectionProvider(row.provider);
  const accessToken = decryptToken(row.accessToken);
  if (provider && accessToken && row.status === "active") {
    try {
      await provider.revoke({
        accessToken,
        refreshToken: decryptToken(row.refreshToken) ?? undefined,
        env: process.env,
      });
    } catch (e) {
      // The tenant still wants the link gone; log and continue.
      logger.warn("OAuth revoke failed; deleting connection anyway", {
        connectionId: row.id,
        provider: row.provider,
        ...serializeError(e),
      });
    }
  }
  await db.oAuthConnection.delete({ where: { id: row.id } });
}
