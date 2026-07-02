import "server-only";
import { db } from "@/lib/db";

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
  } else {
    try {
      // In production: call provider API (Meta Cloud API / Twilio / Termii)
      console.log(`[whatsapp] ${provider} send (simulated): to=${normalized}`);
      result = { success: true, providerRef: `${provider}_sim_${Date.now()}` };
      await db.whatsAppMessage.update({
        where: { id: msgRecord.id },
        data: { status: "sent", providerRef: result.providerRef, sentAt: new Date() },
      });
    } catch (e: any) {
      result = { success: false, error: e?.message || "Send failed" };
      await db.whatsAppMessage.update({ where: { id: msgRecord.id }, data: { status: "failed", errorMessage: result.error } });
    }
  }

  return result;
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^\d]/g, "");
  if (cleaned.startsWith("0") && cleaned.length === 11) cleaned = "234" + cleaned.slice(1);
  return cleaned;
}
