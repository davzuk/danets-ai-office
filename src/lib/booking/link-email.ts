import "server-only";
// The "send_booking_link" automation action: email a lead a link to the
// tenant's hosted booking page, prefilled with their name and email.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/public-cors";
import { isModuleEnabled } from "@/lib/module-access";
import { layout, subjectSafe, text } from "./emails";

export interface BookingLinkOptions {
  /** A specific booking type; otherwise the oldest active one. */
  bookingTypeSlug?: string;
  /** Replaces the default opening line. */
  message?: string;
}

export type BookingLinkResult =
  | { sent: true; to: string; url: string }
  | { sent: false; reason: "lead_not_found" | "no_email" | "module_disabled" | "no_booking_type" | "send_failed" };

/** The hosted booking page for a type, prefilled for one person. */
export function bookingPageUrl(publicKey: string, slug: string, prefill: { name?: string | null; email?: string | null } = {}) {
  const url = new URL(`/book/${encodeURIComponent(publicKey)}/${encodeURIComponent(slug)}`, appOrigin());
  if (prefill.name) url.searchParams.set("name", prefill.name);
  if (prefill.email) url.searchParams.set("email", prefill.email);
  return url.toString();
}

export async function sendBookingLinkEmail(businessId: string, leadId: string, opts: BookingLinkOptions = {}): Promise<BookingLinkResult> {
  const lead = await db.lead.findFirst({ where: { id: leadId, businessId }, select: { name: true, email: true } });
  if (!lead) return { sent: false, reason: "lead_not_found" };
  const email = lead.email?.trim();
  if (!email) return { sent: false, reason: "no_email" };
  if (!(await isModuleEnabled(businessId, "leads"))) return { sent: false, reason: "module_disabled" };

  const slug = opts.bookingTypeSlug?.trim();
  const [business, type] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true, publicKey: true } }),
    db.bookingType.findFirst({
      where: { businessId, active: true, ...(slug ? { slug } : {}) },
      orderBy: { createdAt: "asc" },
      select: { name: true, slug: true, durationMin: true },
    }),
  ]);
  if (!business || !type) return { sent: false, reason: "no_booking_type" };

  const url = bookingPageUrl(business.publicKey, type.slug, { name: lead.name, email });
  const firstName = lead.name.trim().split(/\s+/)[0] || "there";
  const intro = opts.message?.trim().slice(0, 1000) || `Hi ${firstName}, thanks for getting in touch. Pick a time that suits you and we'll take it from there.`;
  const rows = [{ label: "What", value: `${type.name} (${type.durationMin} min)` }];
  const heading = `Book a time with ${business.name}`;

  const result = await sendEmail({
    to: email,
    subject: subjectSafe(`Book your ${type.name} with ${business.name}`),
    html: layout(heading, intro, rows, { label: "Choose a time", href: url }, `Sent on behalf of ${business.name}.`),
    text: text(heading, intro, rows, `Choose a time: ${url}`),
  });
  return result.success ? { sent: true, to: email, url } : { sent: false, reason: "send_failed" };
}
