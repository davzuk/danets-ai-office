// A tenant's Calendly connection, stored as an Integration row (category
// "booking", provider "calendly"). The personal access token and the
// webhook signing key are encrypted at rest; nothing secret leaves the
// server.

import { randomBytes } from "node:crypto";
import type { Integration } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptApiKey, encryptApiKey, isEncryptedPayload, maskApiKey } from "@/lib/crypto";
import { appOrigin } from "@/lib/public-cors";
import { logger, serializeError } from "@/lib/logger";
import { CalendlyError, calendlyEventTypes, calendlyMe, createCalendlyWebhook, deleteCalendlyWebhook, type CalendlyEventType } from "./calendly";

interface StoredConfig {
  apiKey?: unknown; // encrypted personal access token
  signingKey?: unknown; // encrypted webhook signing key
  userUri?: string;
  userName?: string;
  userEmail?: string;
  schedulingUrl?: string;
  webhookUri?: string | null;
  webhookError?: string | null;
}

export interface CalendlyStatus {
  connected: boolean;
  name?: string;
  email?: string;
  schedulingUrl?: string;
  tokenMasked?: string;
  /** Bookings made in Calendly reach Danets only when the webhook exists (paid Calendly plans). */
  webhook: "active" | "unavailable" | "none";
  webhookError?: string | null;
}

const readConfig = (row: Integration): StoredConfig => {
  try {
    return row.config ? (JSON.parse(row.config) as StoredConfig) : {};
  } catch {
    return {};
  }
};

const secret = (v: unknown) => (isEncryptedPayload(v) ? decryptApiKey(v) : null);

export async function getCalendlyIntegration(businessId: string) {
  const row = await db.integration.findFirst({ where: { businessId, category: "booking", provider: "calendly" } });
  return row ? { row, config: readConfig(row) } : null;
}

export async function calendlyStatus(businessId: string): Promise<CalendlyStatus> {
  const found = await getCalendlyIntegration(businessId);
  if (!found) return { connected: false, webhook: "none" };
  const token = secret(found.config.apiKey);
  return {
    connected: !!token,
    name: found.config.userName,
    email: found.config.userEmail,
    schedulingUrl: found.config.schedulingUrl,
    tokenMasked: token ? maskApiKey(token) : undefined,
    webhook: found.config.webhookUri ? "active" : "unavailable",
    webhookError: found.config.webhookError ?? null,
  };
}

/** Where Calendly posts invitee events for this connection. */
export const calendlyWebhookUrl = (integrationId: string) => `${appOrigin()}/api/webhooks/calendly/${integrationId}`;

/**
 * Check the token, store it, and subscribe to invitee events. A free
 * Calendly plan (or a webhook URL Calendly can't reach, such as localhost)
 * keeps the connection without the webhook and says why.
 */
export async function connectCalendly(businessId: string, token: string): Promise<CalendlyStatus> {
  const me = await calendlyMe(token); // throws CalendlyError on a bad token

  const previous = await getCalendlyIntegration(businessId);
  if (previous) await disconnectCalendly(businessId).catch(() => {});

  const signingKey = randomBytes(32).toString("base64url");
  const row = await db.integration.create({
    data: {
      businessId,
      category: "booking",
      provider: "calendly",
      name: "Calendly",
      status: "active",
      config: JSON.stringify({
        apiKey: encryptApiKey(token),
        signingKey: encryptApiKey(signingKey),
        userUri: me.uri,
        userName: me.name,
        userEmail: me.email,
        schedulingUrl: me.schedulingUrl,
        webhookUri: null,
        webhookError: null,
      } satisfies StoredConfig),
    },
  });

  let webhookUri: string | null = null;
  let webhookError: string | null = null;
  try {
    webhookUri = await createCalendlyWebhook(token, { url: calendlyWebhookUrl(row.id), user: me, signingKey });
  } catch (e) {
    webhookError =
      e instanceof CalendlyError && e.status === 403
        ? "Calendly only sends booking webhooks on paid plans. Your link still works; bookings just won't appear in Danets."
        : `Calendly couldn't set up the webhook: ${(e as Error).message}`;
    logger.warn("calendly webhook not created", { businessId, ...serializeError(e) });
  }
  const config = { ...readConfig(row), webhookUri, webhookError };
  await db.integration.update({ where: { id: row.id }, data: { config: JSON.stringify(config), lastTestedAt: new Date() } });
  return calendlyStatus(businessId);
}

export async function disconnectCalendly(businessId: string): Promise<void> {
  const found = await getCalendlyIntegration(businessId);
  if (!found) return;
  const token = secret(found.config.apiKey);
  if (token && found.config.webhookUri) {
    await deleteCalendlyWebhook(token, found.config.webhookUri).catch((e) => logger.warn("calendly webhook not removed", { businessId, ...serializeError(e) }));
  }
  await db.integration.delete({ where: { id: found.row.id } });
}

/** The connected account's event types, to match booking types to them. */
export async function listCalendlyEventTypes(businessId: string): Promise<CalendlyEventType[]> {
  const found = await getCalendlyIntegration(businessId);
  const token = found ? secret(found.config.apiKey) : null;
  if (!found || !token || !found.config.userUri) return [];
  return calendlyEventTypes(token, found.config.userUri);
}

/** The signing key for a webhook delivery, with the tenant it belongs to. */
export async function calendlyWebhookSecret(integrationId: string): Promise<{ businessId: string; signingKey: string } | null> {
  const row = await db.integration.findFirst({ where: { id: integrationId, category: "booking", provider: "calendly" } });
  if (!row) return null;
  const key = secret(readConfig(row).signingKey);
  return key ? { businessId: row.businessId, signingKey: key } : null;
}

/** Trailing-slash-insensitive comparison of scheduling links. */
export const sameCalendlyLink = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
