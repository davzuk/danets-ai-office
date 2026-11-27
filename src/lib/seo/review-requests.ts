import "server-only";
// "Please review us" messages (Phase 3, workstream X): the
// send_review_request automation action and its tracked short link.
//
// Guardrails:
//  - at most one request per person every 90 days (by contact, and by the
//    email or phone it went to);
//  - never to someone who refused consent for that channel;
//  - no review gating: everyone gets the same link to the location's
//    Google review form, whatever their experience (Google's policy).

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { isModuleEnabled } from "@/lib/module-access";
import { appOrigin } from "@/lib/public-cors";
import { normalizeEmail, normalizePhone } from "@/lib/contacts";
import { layout, subjectSafe, text } from "@/lib/booking/emails";

export const COOLDOWN_DAYS = 90;
export const REVIEW_CHANNELS = ["email", "whatsapp"] as const;
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

export interface ReviewRequestConfig {
  channel?: string;
  locationId?: string;
  message?: string;
}

export interface ReviewRequestContext {
  leadId?: string;
  bookingId?: string;
  workflowId?: string;
}

export type ReviewRequestResult =
  | { sent: true; requestId: string; to: string; channel: ReviewChannel }
  | {
      sent: false;
      reason: "module_disabled" | "no_location" | "no_review_link" | "no_person" | "no_address" | "no_consent" | "cooldown" | "whatsapp_unavailable" | "send_failed";
    };

/** Consent the contact explicitly refused for this channel. Unknown counts as allowed (it's a service follow-up, not marketing). Pure. */
export function refusedConsent(consent: unknown, channel: ReviewChannel): boolean {
  if (!consent || typeof consent !== "object") return false;
  const c = consent as Record<string, { granted?: unknown } | undefined>;
  const entry = channel === "email" ? c.marketingEmail : c.whatsapp;
  return entry?.granted === false;
}

export const reviewLink = (token: string) => new URL(`/r/${token}`, appOrigin()).toString();

/** The message body. Pure. */
export function reviewRequestText(args: { name: string | null; businessName: string; locationTitle: string; message?: string | null; link: string }) {
  const first = args.name?.trim().split(/\s+/)[0];
  const intro =
    args.message?.trim().slice(0, 600).replace(/\{name\}/g, first || "there") ||
    `Hi ${first || "there"}, thanks for choosing ${args.businessName}. If you have a minute, we'd really appreciate a review on Google. It helps other people find us.`;
  return { intro, whatsapp: `${intro}\n\n${args.link}` };
}

interface Person {
  name: string | null;
  email: string | null;
  phone: string | null;
  contactId: string | null;
  leadId: string | null;
  bookingId: string | null;
}

async function personFor(businessId: string, ctx: ReviewRequestContext): Promise<Person | null> {
  if (ctx.bookingId) {
    const b = await db.booking.findFirst({ where: { id: ctx.bookingId, businessId }, select: { id: true, name: true, email: true, phone: true, contactId: true, leadId: true } });
    if (b) return { name: b.name, email: b.email, phone: b.phone, contactId: b.contactId, leadId: b.leadId, bookingId: b.id };
  }
  if (ctx.leadId) {
    const l = await db.lead.findFirst({ where: { id: ctx.leadId, businessId }, select: { id: true, name: true, email: true, phone: true, contactId: true } });
    if (l) return { name: l.name, email: l.email, phone: l.phone, contactId: l.contactId, leadId: l.id, bookingId: null };
  }
  return null;
}

export async function sendReviewRequest(businessId: string, ctx: ReviewRequestContext, config: ReviewRequestConfig, now = new Date()): Promise<ReviewRequestResult> {
  if (!(await isModuleEnabled(businessId, "seo"))) return { sent: false, reason: "module_disabled" };
  const channel: ReviewChannel = config.channel === "whatsapp" ? "whatsapp" : "email";

  const location = await db.businessLocation.findFirst({
    where: { businessId, status: "active", ...(config.locationId ? { id: config.locationId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!location) return { sent: false, reason: "no_location" };
  if (!location.reviewUri) return { sent: false, reason: "no_review_link" };

  const person = await personFor(businessId, ctx);
  if (!person) return { sent: false, reason: "no_person" };
  const to = channel === "email" ? normalizeEmail(person.email) : normalizePhone(person.phone);
  if (!to) return { sent: false, reason: "no_address" };

  if (person.contactId) {
    const contact = await db.contact.findUnique({ where: { id: person.contactId }, select: { consent: true } });
    if (refusedConsent(contact?.consent, channel)) return { sent: false, reason: "no_consent" };
  }

  const since = new Date(now.getTime() - COOLDOWN_DAYS * 86_400_000);
  const recent = await db.reviewRequest.findFirst({
    where: { businessId, sentAt: { gte: since }, OR: [{ recipient: to }, ...(person.contactId ? [{ contactId: person.contactId }] : [])] },
    select: { id: true },
  });
  if (recent) return { sent: false, reason: "cooldown" };

  if (channel === "whatsapp") {
    if (!(await isModuleEnabled(businessId, "whatsapp"))) return { sent: false, reason: "whatsapp_unavailable" };
    const integration = await db.whatsAppIntegration.findFirst({ where: { businessId }, select: { provider: true, status: true } });
    if (!integration || integration.provider === "manual" || integration.status !== "active") return { sent: false, reason: "whatsapp_unavailable" };
  }

  // Reserve the cooldown before sending, so two triggers at once send once.
  const token = randomBytes(12).toString("base64url");
  const row = await db.reviewRequest.create({
    data: {
      businessId,
      locationId: location.id,
      contactId: person.contactId,
      leadId: person.leadId,
      bookingId: person.bookingId,
      workflowId: ctx.workflowId ?? null,
      channel,
      recipient: to,
      token,
      sentAt: now,
    },
  });

  const business = await db.business.findUnique({ where: { id: businessId }, select: { name: true } });
  const businessName = business?.name ?? "us";
  const link = reviewLink(token);
  const msg = reviewRequestText({ name: person.name, businessName, locationTitle: location.title, message: config.message, link });

  let ok = false;
  try {
    if (channel === "email") {
      const heading = `How did we do?`;
      const r = await sendEmail({
        to,
        subject: subjectSafe(`Would you review ${businessName}?`),
        html: layout(heading, msg.intro, [], { label: "Leave a review on Google", href: link }, `Sent by ${businessName}. You're getting this because you were recently in touch with them.`),
        text: text(heading, msg.intro, [], `Leave a review: ${link}`),
      });
      ok = r.success;
    } else {
      const r = await sendWhatsAppMessage(businessId, to, msg.whatsapp, { leadId: person.leadId ?? undefined, sentByName: "Review request" });
      ok = r.success;
    }
  } catch (e) {
    logger.warn("Review request send failed", { businessId, requestId: row.id, ...serializeError(e) });
  }
  if (!ok) {
    await db.reviewRequest.delete({ where: { id: row.id } });
    return { sent: false, reason: "send_failed" };
  }
  return { sent: true, requestId: row.id, to, channel };
}

/** Only Google's own pages are redirect targets (the URL comes from Google's API). Pure. */
export function isGoogleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // Google's API returns search.google.com / maps.google.com (and short
    // g.page / goo.gl links); a looser google.* pattern would let
    // "google.com.attacker.test" through.
    return u.protocol === "https:" && /(^|\.)(google\.com|g\.page|goo\.gl)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Count a click on a review link and say where to send the person. */
export async function followReviewLink(token: string, now = new Date()): Promise<string | null> {
  if (!/^[\w-]{8,32}$/.test(token)) return null;
  const row = await db.reviewRequest.findUnique({ where: { token }, include: { location: { select: { reviewUri: true, mapsUri: true } } } });
  if (!row) return null;
  await db.reviewRequest.update({ where: { id: row.id }, data: { clicks: { increment: 1 }, ...(row.clickedAt ? {} : { clickedAt: now }) } });
  return row.location.reviewUri ?? row.location.mapsUri ?? null;
}
