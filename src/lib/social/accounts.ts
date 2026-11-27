// Social accounts: the Pages / Instagram accounts / LinkedIn pages a tenant
// connected, one row per asset. Rows are owned by exactly one business
// (unique on platform + externalId) so webhooks route unambiguously.

import type { OAuthConnection, Prisma, SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/crypto";
import { logger, serializeError } from "@/lib/logger";
import type { SocialAssetInput, SocialPlatform } from "@/lib/connections/types";

export const SOCIAL_PLATFORMS: SocialPlatform[] = ["facebook_page", "instagram", "linkedin_page"];
export const AUTO_REPLY_MODES = ["off", "draft", "auto"] as const;
export type AutoReplyMode = (typeof AUTO_REPLY_MODES)[number];

type ExistingRow = Pick<SocialAccount, "id" | "businessId" | "connectionId" | "platform" | "externalId" | "status">;

export interface AssetSyncPlan {
  /** Assets to create or refresh for this business. */
  upserts: SocialAssetInput[];
  /** Assets another tenant already owns; left untouched. */
  conflicts: SocialAssetInput[];
  /** Ids of this connection's rows that the new grant no longer includes. */
  revokeIds: string[];
}

const key = (platform: string, externalId: string) => `${platform}:${externalId}`;

/**
 * Decide what a fresh grant means for stored rows. `existing` must hold
 * every row matching an incoming asset (any business) plus all rows of
 * this connection.
 */
export function planAssetSync(
  businessId: string,
  connectionId: string,
  assets: SocialAssetInput[],
  existing: ExistingRow[]
): AssetSyncPlan {
  const byKey = new Map(existing.map((r) => [key(r.platform, r.externalId), r]));
  const incoming = new Set<string>();
  const plan: AssetSyncPlan = { upserts: [], conflicts: [], revokeIds: [] };

  for (const a of assets) {
    const k = key(a.platform, a.externalId);
    if (incoming.has(k)) continue;
    incoming.add(k);
    const row = byKey.get(k);
    if (row && row.businessId !== businessId) plan.conflicts.push(a);
    else plan.upserts.push(a);
  }
  for (const r of existing) {
    // Business Profile locations are managed from SEO setup, not by the connection's asset list.
    if (r.platform === "google_business") continue;
    if (r.connectionId === connectionId && r.businessId === businessId && !incoming.has(key(r.platform, r.externalId)) && r.status !== "revoked") {
      plan.revokeIds.push(r.id);
    }
  }
  return plan;
}

export interface SyncResult {
  synced: SocialAccount[];
  conflicts: SocialAssetInput[];
  revoked: number;
}

/** Store the assets a connection grants. Toggles the tenant set are kept on refresh. */
export async function syncSocialAccounts(
  connection: Pick<OAuthConnection, "id" | "businessId">,
  assets: SocialAssetInput[]
): Promise<SyncResult> {
  const existing = await db.socialAccount.findMany({
    where: {
      OR: [
        { connectionId: connection.id },
        ...assets.map((a) => ({ platform: a.platform, externalId: a.externalId })),
      ],
    },
    select: { id: true, businessId: true, connectionId: true, platform: true, externalId: true, status: true },
  });
  const plan = planAssetSync(connection.businessId, connection.id, assets, existing);

  const synced: SocialAccount[] = [];
  for (const a of plan.upserts) {
    const fields = {
      connectionId: connection.id,
      parentExternalId: a.parentExternalId ?? null,
      name: a.name.slice(0, 191),
      username: a.username?.slice(0, 191) ?? null,
      pictureUrl: a.pictureUrl ?? null,
      tasks: (a.tasks ?? []) as Prisma.InputJsonValue,
      accessToken: (a.accessToken ?? undefined) as Prisma.InputJsonValue | undefined,
      status: "active",
      lastError: null,
    };
    synced.push(
      await db.socialAccount.upsert({
        where: { platform_externalId: { platform: a.platform, externalId: a.externalId } },
        create: { businessId: connection.businessId, platform: a.platform, externalId: a.externalId, ...fields },
        // A reconnect may hand a fresh token; webhook subscription is redone after.
        update: fields,
      })
    );
  }

  if (plan.revokeIds.length) {
    await db.socialAccount.updateMany({
      where: { id: { in: plan.revokeIds }, businessId: connection.businessId },
      data: { status: "revoked", lastError: "No longer granted in the latest connection", subscribedAt: null },
    });
  }
  if (plan.conflicts.length) {
    logger.warn("Social assets already connected to another workspace", {
      connectionId: connection.id,
      assets: plan.conflicts.map((a) => key(a.platform, a.externalId)),
    });
  }
  return { synced, conflicts: plan.conflicts, revoked: plan.revokeIds.length };
}

/** Decrypted asset token (Meta page token), or null. */
export function socialAccountToken(row: Pick<SocialAccount, "accessToken">): string | null {
  if (row.accessToken == null) return null;
  try {
    return decryptApiKey(row.accessToken);
  } catch (e) {
    logger.error("Could not decrypt social account token", serializeError(e));
    return null;
  }
}

/** Active account for a webhook entry id, or null when unknown / disabled. */
export async function findActiveSocialAccount(platform: SocialPlatform, externalId: string) {
  return db.socialAccount.findFirst({ where: { platform, externalId, status: "active" } });
}

/** Client-safe view (no token). */
export interface PublicSocialAccount {
  id: string;
  connectionId: string;
  platform: string;
  externalId: string;
  parentExternalId: string | null;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  inboxEnabled: boolean;
  leadSyncEnabled: boolean;
  publishEnabled: boolean;
  autoReply: string;
  subscribed: boolean;
  status: string;
  lastError: string | null;
}

export function toPublicSocialAccount(row: SocialAccount): PublicSocialAccount {
  return {
    id: row.id,
    connectionId: row.connectionId,
    platform: row.platform,
    externalId: row.externalId,
    parentExternalId: row.parentExternalId,
    name: row.name,
    username: row.username,
    pictureUrl: row.pictureUrl,
    inboxEnabled: row.inboxEnabled,
    leadSyncEnabled: row.leadSyncEnabled,
    publishEnabled: row.publishEnabled,
    autoReply: row.autoReply,
    subscribed: !!row.subscribedAt,
    status: row.status,
    lastError: row.lastError,
  };
}
