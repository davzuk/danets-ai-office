import "server-only";
// A WhatsApp reminder alongside the reminder email, when the tenant has the
// WhatsApp module, a live provider (not click-to-chat), and an active
// "booking_reminder" template.
//
// Meta's Cloud API only delivers free-form text inside the 24-hour customer
// service window; outside it, Meta requires an approved template message,
// which this send doesn't use. Reminders to someone who hasn't messaged the
// business recently may therefore be rejected by the provider. That's logged
// and the email still goes.

import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import type { BookingEmailData } from "./emails";

export const BOOKING_REMINDER_TEMPLATE = "booking_reminder";

/** Fill {name} {service} {company} {time} {link}; unknown placeholders stay as written. */
export function fillBookingReminder(content: string, d: Pick<BookingEmailData, "name" | "typeName" | "businessName" | "startsAt" | "visitorTimezone" | "businessTimezone" | "manageUrl">) {
  const tz = d.visitorTimezone || d.businessTimezone;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d.startsAt);
  const values: Record<string, string> = {
    name: d.name.trim().split(/\s+/)[0] || d.name,
    service: d.typeName,
    company: d.businessName,
    time: `${time} (${tz})`,
    link: d.manageUrl,
  };
  return content.replace(/\{(name|service|company|time|link)\}/g, (_, k: string) => values[k]);
}

export async function sendBookingWhatsAppReminder(businessId: string, d: BookingEmailData, leadId: string | null): Promise<"sent" | "skipped" | "failed"> {
  if (!d.phone) return "skipped";
  try {
    if (!(await isModuleEnabled(businessId, "whatsapp"))) return "skipped";
    const [integration, template] = await Promise.all([
      db.whatsAppIntegration.findFirst({ where: { businessId }, select: { provider: true, status: true } }),
      db.whatsAppTemplate.findFirst({ where: { businessId, type: BOOKING_REMINDER_TEMPLATE, isActive: true }, orderBy: { updatedAt: "desc" } }),
    ]);
    if (!integration || integration.provider === "manual" || integration.status !== "active" || !template) return "skipped";
    const result = await sendWhatsAppMessage(businessId, d.phone, fillBookingReminder(template.content, d), {
      leadId: leadId ?? undefined,
      templateId: template.id,
      sentByName: "Booking reminder",
    });
    if (!result.success) {
      logger.warn("booking WhatsApp reminder failed", { businessId, bookingId: d.bookingId, error: result.error });
      return "failed";
    }
    return "sent";
  } catch (e) {
    logger.warn("booking WhatsApp reminder failed", { businessId, bookingId: d.bookingId, ...serializeError(e) });
    return "failed";
  }
}
