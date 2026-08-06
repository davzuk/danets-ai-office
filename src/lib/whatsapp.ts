import "server-only";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/crypto";

/**
 * Read an apiKey column, transparently decrypting if it's our envelope and
 * returning the legacy plaintext otherwise. Centralized so every consumer
 * sees the same migration path without each route re-implementing it.
 */
export function resolveApiKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let envelope: unknown = null;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return raw; // legacy plaintext
  }
  if (envelope && typeof envelope === "object" && (envelope as any).__enc === 1) {
    return decryptApiKey(envelope);
  }
  return raw; // unrecognized shape — fail open to the legacy value
}

export interface SendResult {
  success: boolean;
  providerRef?: string;
  error?: string;
  clickToChatUrl?: string;
}

export async function sendWhatsAppMessage(
  businessId: string,
  phoneNumber: string,
  message: string,
  options?: { leadId?: string; templateId?: string; sentBy?: string; sentByName?: string }
): Promise<SendResult> {
  const normalized = normalizePhone(phoneNumber);
  const integration = await db.whatsAppIntegration.findFirst({ where: { businessId } });
  const provider = integration?.provider || "manual";

  const msgRecord = await db.whatsAppMessage.create({
    data: {
      businessId, direction: "outbound", status: "pending", phoneNumber: normalized, message,
      templateId: options?.templateId || null, leadId: options?.leadId || null,
      sentBy: options?.sentBy || null, sentByName: options?.sentByName || null,
    },
  });

  let result: SendResult;

  if (provider === "manual") {
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
    result = { success: true, clickToChatUrl: url };
    await db.whatsAppMessage.update({ where: { id: msgRecord.id }, data: { status: "sent", sentAt: new Date() } });
  } else if (provider === "meta_cloud_api") {
    result = await sendViaMetaCloudApi(integration!, normalized, message);
    await db.whatsAppMessage.update({
      where: { id: msgRecord.id },
      data: result.success
        ? { status: "sent", providerRef: result.providerRef, sentAt: new Date() }
        : { status: "failed", errorMessage: result.error },
    });
  } else {
    result = {
      success: false,
      error: `Live send for provider "${provider}" is not configured. Use manual mode or Meta Cloud API.`,
    };
    await db.whatsAppMessage.update({
      where: { id: msgRecord.id },
      data: { status: "failed", errorMessage: result.error },
    });
  }

  return result;
}

async function sendViaMetaCloudApi(
  integration: { apiKey: string | null; phoneNumberId: string | null },
  phone: string,
  message: string
): Promise<SendResult> {
  const token = resolveApiKey(integration.apiKey)?.trim() || null;
  const phoneNumberId = integration.phoneNumberId?.trim();

  if (!token || !phoneNumberId) {
    return {
      success: false,
      error: "Meta Cloud API requires an access token and phone number ID.",
    };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      error: data?.error?.message || `Meta API error (${res.status})`,
    };
  }

  return {
    success: true,
    providerRef: data.messages?.[0]?.id || `meta_${Date.now()}`,
  };
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^\d]/g, "");
  if (cleaned.startsWith("0") && cleaned.length === 11) cleaned = "234" + cleaned.slice(1);
  return cleaned;
}
