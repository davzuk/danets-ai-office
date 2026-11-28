// Booking service: create, reschedule and cancel bookings, and everything
// that follows (contact, touchpoint, lead, activity, notifications,
// automations, emails, reminders). Used by the public API, the hosted page,
// the widget and the dashboard.

import { randomBytes } from "node:crypto";
import { Prisma, type Booking, type BookingType } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";
import { captureInbound } from "@/lib/inbound-attribution";
import { leadSourceFromChannel } from "@/lib/attribution";
import { checkQuota } from "@/lib/plan-quota";
import { appOrigin } from "@/lib/public-cors";
import { logger, serializeError } from "@/lib/logger";
import { sendBookingEmails, type BookingEmailData, type BookingEmailKind } from "./emails";
import { computeSlots, isBookableSlot, readAvailability, readQuestions, type Busy, type SlotRules } from "./slots";
import { externalBusy, pushBookingEvent } from "./calendar-sync";
import type { CalendlyInvitee } from "./calendly";

export type BookingErrorCode = "SLOT_TAKEN" | "NOT_FOUND" | "CLOSED" | "INVALID";

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BookingError";
  }
}

type Tx = Prisma.TransactionClient | typeof db;

export function slotRulesFor(type: Pick<BookingType, "availability" | "durationMin" | "bufferMin" | "minNoticeHours" | "maxDaysAhead" | "slotStepMin">, timezone: string): SlotRules {
  return {
    availability: readAvailability(type.availability),
    timezone,
    durationMin: type.durationMin,
    bufferMin: type.bufferMin,
    minNoticeHours: type.minNoticeHours,
    maxDaysAhead: type.maxDaysAhead,
    slotStepMin: type.slotStepMin,
  };
}

/**
 * Confirmed bookings of the whole business around a range, as busy periods.
 * One calendar per business for now: every booking type shares it. Each
 * booking keeps its own buffer after it.
 */
export async function busyFor(tx: Tx, businessId: string, from: Date, to: Date, excludeId?: string): Promise<Busy[]> {
  const pad = 24 * 3_600_000;
  const rows = await tx.booking.findMany({
    where: {
      businessId,
      status: "confirmed",
      startsAt: { lt: new Date(to.getTime() + pad) },
      endsAt: { gt: new Date(from.getTime() - pad) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startsAt: true, endsAt: true, bufferMin: true },
  });
  return rows.map((r) => ({ start: r.startsAt, end: new Date(r.endsAt.getTime() + r.bufferMin * 60_000) }));
}

export async function slotsFor(type: BookingType, timezone: string, range: { from: Date; to: Date }, now = new Date()): Promise<Date[]> {
  const [busy, external] = await Promise.all([busyFor(db, type.businessId, range.from, range.to), externalBusy(type, range.from, range.to)]);
  return computeSlots(slotRulesFor(type, timezone), [...busy, ...external], range, now);
}

/** Calendar busy times around one slot, fetched before the booking transaction (no HTTP while the row is locked). */
const PAD_MS = 6 * 3_600_000;
const externalAround = (type: BookingType, start: Date, end: Date, own?: { start: Date; end: Date }) =>
  externalBusy(type, new Date(start.getTime() - PAD_MS), new Date(end.getTime() + PAD_MS), own);

const newToken = () => randomBytes(24).toString("base64url");

/** Lock the business row so overlapping bookings are checked one at a time. */
async function lockBusiness(tx: Prisma.TransactionClient, businessId: string) {
  await tx.$queryRaw`SELECT id FROM \`Business\` WHERE id = ${businessId} FOR UPDATE`;
}

const TX_OPTS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 } as const;

export interface CreateBookingArgs {
  business: { id: string; name: string; timezone: string };
  type: BookingType;
  start: Date;
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  answers?: Record<string, string>;
  visitorTimezone?: string | null;
  source: "page" | "widget" | "dashboard" | "calendly";
  sessionId?: string | null;
  visitorId?: string | null;
  attribution?: unknown;
  consentText?: string | null;
}

export async function createBooking(args: CreateBookingArgs, now = new Date()): Promise<Booking> {
  const { business, type } = args;
  if (!type.active) throw new BookingError("CLOSED", "This booking page isn't taking bookings right now.");
  const rules = slotRulesFor(type, business.timezone);
  const endsAt = new Date(args.start.getTime() + type.durationMin * 60_000);
  const email = args.email.trim().toLowerCase();

  const sessionId = args.sessionId
    ? (await db.chatSession.findFirst({ where: { id: args.sessionId, businessId: business.id }, select: { id: true } }))?.id ?? null
    : null;

  const external = await externalAround(type, args.start, endsAt);
  const booking = await db.$transaction(async (tx) => {
    await lockBusiness(tx, business.id);
    const busy = [...(await busyFor(tx, business.id, args.start, endsAt)), ...external];
    if (!isBookableSlot(rules, busy, args.start, now)) {
      throw new BookingError("SLOT_TAKEN", "Sorry, that time was just taken. Please pick another.");
    }
    return tx.booking.create({
      data: {
        businessId: business.id,
        bookingTypeId: type.id,
        sessionId,
        name: args.name.trim(),
        email,
        phone: args.phone?.trim() || null,
        notes: args.notes?.trim() || null,
        answers: args.answers && Object.keys(args.answers).length ? args.answers : undefined,
        startsAt: args.start,
        endsAt,
        bufferMin: type.bufferMin,
        visitorTimezone: args.visitorTimezone || null,
        source: args.source,
        consentText: args.consentText?.trim() || null,
        cancelToken: newToken(),
      },
    });
  }, TX_OPTS);

  // Everything below is follow-up: the booking stands even if one step fails.
  let leadId: string | null = null;
  let contactId: string | null = null;
  try {
    const inbound = await captureInbound({
      businessId: business.id,
      kind: "booking",
      visitorId: args.visitorId,
      attribution: args.attribution,
      campaignId: type.campaignId,
      profile: { name: booking.name, email, phone: booking.phone },
    });
    contactId = inbound?.contactId ?? null;
    leadId = await upsertLeadForBooking(booking, type.name, contactId, inbound ? { source: inbound.attributed ? leadSourceFromChannel(inbound.channel) : "website_form", firstTouchId: inbound.firstTouch.id, lastTouchId: inbound.touch.id } : null);
    if (leadId || contactId) {
      await db.booking.update({ where: { id: booking.id }, data: { leadId, contactId } });
    }
    if (sessionId) {
      await db.chatSession.update({
        where: { id: sessionId },
        data: { visitorName: booking.name, visitorEmail: email, ...(booking.phone ? { visitorPhone: booking.phone } : {}), ...(contactId ? { contactId } : {}) },
      });
    }
  } catch (e) {
    logger.error("booking follow-up (lead/contact) failed", { bookingId: booking.id, ...serializeError(e) });
  }

  const final = { ...booking, leadId, contactId };
  await afterChange("confirmed", final, type, business);
  return final;
}

async function upsertLeadForBooking(
  booking: Booking,
  typeName: string,
  contactId: string | null,
  attribution: { source: string; firstTouchId: string; lastTouchId: string } | null
): Promise<string | null> {
  const when = booking.startsAt.toISOString();
  const existing = await db.lead.findUnique({
    where: { Lead_businessId_email_key: { businessId: booking.businessId, email: booking.email } },
  });
  if (existing) {
    const promote = existing.status === "new" || existing.status === "contacted";
    await db.lead.update({
      where: { id: existing.id },
      data: {
        ...(promote ? { status: "qualified" } : {}),
        ...(!existing.phone && booking.phone ? { phone: booking.phone } : {}),
        ...(!existing.contactId && contactId ? { contactId } : {}),
        ...(attribution ? { lastTouchId: attribution.lastTouchId } : {}),
      },
    });
    await db.leadActivity.create({
      data: {
        leadId: existing.id,
        businessId: booking.businessId,
        type: "booking",
        description: `Booked a ${typeName}${promote ? " (moved to Qualified)" : ""}`,
        metadata: JSON.stringify({ bookingId: booking.id, startsAt: when }),
      },
    });
    return existing.id;
  }

  const quota = await checkQuota(booking.businessId, "leads");
  if (!quota.allowed) {
    logger.warn("booking made without a lead: lead quota reached", { bookingId: booking.id, businessId: booking.businessId });
    return null;
  }
  try {
    const lead = await db.lead.create({
      data: {
        businessId: booking.businessId,
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        service: typeName,
        message: booking.notes,
        quality: "high",
        status: "qualified",
        source: attribution?.source ?? "website_form",
        contactId,
        firstTouchId: attribution?.firstTouchId ?? null,
        lastTouchId: attribution?.lastTouchId ?? null,
      },
    });
    await db.leadActivity.create({
      data: {
        leadId: lead.id,
        businessId: booking.businessId,
        type: "booking",
        description: `Booked a ${typeName}`,
        metadata: JSON.stringify({ bookingId: booking.id, startsAt: when }),
      },
    });
    if (booking.consentText) {
      await db.leadActivity.create({
        data: {
          leadId: lead.id,
          businessId: booking.businessId,
          type: "consent",
          description: "Agreed to the booking consent notice",
          metadata: JSON.stringify({ text: booking.consentText, at: new Date().toISOString(), via: "booking" }),
        },
      });
    }
    return lead.id;
  } catch (e: any) {
    // Another request created the lead with this email a moment ago.
    if (e?.code === "P2002") {
      const again = await db.lead.findUnique({ where: { Lead_businessId_email_key: { businessId: booking.businessId, email: booking.email } } });
      return again?.id ?? null;
    }
    throw e;
  }
}

/** Notification, automation trigger, emails and reminders after any change. Never throws. */
async function afterChange(
  kind: Exclude<BookingEmailKind, "reminder">,
  booking: Booking,
  type: BookingType | null,
  business: { id: string; name: string; timezone: string },
  opts: { by?: "visitor" | "business" } = {}
) {
  const typeName = type?.name ?? "Booking";
  // Calendly sends its own emails and reminders; Danets only records the booking.
  const viaCalendly = booking.externalProvider === "calendly";
  if (!viaCalendly) booking = await pushBookingEvent(kind, booking, type, business.name);
  try {
    if (kind === "confirmed" || opts.by !== "business") {
      await createNotification({
        businessId: business.id,
        userId: type?.assignedUserId ?? null,
        type: kind === "cancelled" ? "booking_cancelled" : "booking_created",
        title: kind === "confirmed" ? "New booking" : kind === "rescheduled" ? "Booking moved" : "Booking cancelled",
        message: `${booking.name}: ${typeName}, ${new Intl.DateTimeFormat("en-GB", { timeZone: business.timezone, dateStyle: "medium", timeStyle: "short" }).format(booking.startsAt)}`,
        data: { bookingId: booking.id, leadId: booking.leadId },
      });
    }
    if (kind === "confirmed" || kind === "cancelled") {
      await fireTrigger(kind === "confirmed" ? "booking_created" : "booking_cancelled", {
        businessId: business.id,
        leadId: booking.leadId ?? undefined,
        leadName: booking.name,
        bookingId: booking.id,
        bookingTypeName: typeName,
        startsAt: booking.startsAt.toISOString(),
      });
    }
  } catch (e) {
    logger.error("booking notification/trigger failed", { bookingId: booking.id, ...serializeError(e) });
  }

  if (kind !== "cancelled") await scheduleCompletion(booking);
  if (viaCalendly) return;

  try {
    const data = await emailDataFor(booking.id);
    if (data) await sendBookingEmails(kind, data, { cancelledBy: opts.by });
  } catch (e) {
    logger.error("booking emails failed", { bookingId: booking.id, ...serializeError(e) });
  }

  if (kind !== "cancelled") await scheduleReminders(booking);
}

/** 24-hour and 1-hour reminders. The dedupe key includes the start, so a reschedule queues fresh ones and old ones no-op. */
export async function scheduleReminders(booking: Pick<Booking, "id" | "businessId" | "startsAt">, now = new Date()) {
  try {
    const { enqueue } = await import("@/lib/jobs/queue");
    const { bookingRemindJob } = await import("@/lib/jobs/handlers/booking-remind");
    for (const [kind, hours] of [["24h", 24], ["1h", 1]] as const) {
      const runAt = new Date(booking.startsAt.getTime() - hours * 3_600_000);
      // Too late for this reminder (e.g. booked for tomorrow morning).
      if (runAt.getTime() < now.getTime() + 5 * 60_000) continue;
      await enqueue(
        bookingRemindJob,
        { bookingId: booking.id, startsAt: booking.startsAt.toISOString(), kind },
        { runAt, businessId: booking.businessId, dedupeKey: `booking-remind:${booking.id}:${kind}:${booking.startsAt.toISOString()}` }
      );
    }
  } catch (e) {
    logger.error("booking reminders not scheduled", { bookingId: booking.id, ...serializeError(e) });
  }
}

/** The booking_completed trigger, half an hour after the meeting ends. Keyed by the end, so a reschedule queues a fresh one. */
export async function scheduleCompletion(booking: Pick<Booking, "id" | "businessId" | "endsAt">) {
  try {
    const { enqueue } = await import("@/lib/jobs/queue");
    const { bookingCompleteJob, COMPLETE_AFTER_MS } = await import("@/lib/jobs/handlers/booking-complete");
    await enqueue(
      bookingCompleteJob,
      { bookingId: booking.id, endsAt: booking.endsAt.toISOString() },
      { runAt: new Date(booking.endsAt.getTime() + COMPLETE_AFTER_MS), businessId: booking.businessId, dedupeKey: `booking-complete:${booking.id}:${booking.endsAt.toISOString()}` }
    );
  } catch (e) {
    logger.error("booking completion not scheduled", { bookingId: booking.id, ...serializeError(e) });
  }
}

/** Everything the emails need, or null when the booking is gone. */
export async function emailDataFor(bookingId: string): Promise<BookingEmailData | null> {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    include: { bookingType: true, business: { select: { name: true, email: true, timezone: true } } },
  });
  if (!b) return null;
  let businessEmail: string | null = null;
  if (b.bookingType?.assignedUserId) {
    businessEmail = (await db.businessUser.findFirst({ where: { id: b.bookingType.assignedUserId, businessId: b.businessId }, select: { email: true } }))?.email ?? null;
  }
  businessEmail ??= b.business.email;
  businessEmail ??= (await db.businessUser.findFirst({ where: { businessId: b.businessId, role: "admin" }, orderBy: { createdAt: "asc" }, select: { email: true } }))?.email ?? null;

  const questions = readQuestions(b.bookingType?.questions);
  const answers = (b.answers && typeof b.answers === "object" ? (b.answers as Record<string, unknown>) : {}) as Record<string, unknown>;
  const origin = appOrigin();
  return {
    bookingId: b.id,
    sequence: b.sequence,
    businessName: b.business.name,
    businessEmail,
    typeName: b.bookingType?.name ?? "Booking",
    location: b.bookingType?.location ?? "custom",
    locationDetail: b.bookingType?.locationDetail ?? null,
    meetingUrl: b.meetingUrl,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    businessTimezone: b.business.timezone,
    visitorTimezone: b.visitorTimezone,
    name: b.name,
    email: b.email,
    phone: b.phone,
    notes: b.notes,
    answers: questions.filter((q) => typeof answers[q.key] === "string" && answers[q.key]).map((q) => ({ label: q.label, value: String(answers[q.key]) })),
    manageUrl: `${origin}/book/manage/${b.cancelToken}`,
    dashboardUrl: `${origin}/app?view=leads&tab=bookings`,
  };
}

async function loadForChange(where: Prisma.BookingWhereUniqueInput) {
  const b = await db.booking.findUnique({
    where,
    include: { bookingType: true, business: { select: { id: true, name: true, timezone: true } } },
  });
  if (!b) throw new BookingError("NOT_FOUND", "Booking not found.");
  return b;
}

export async function cancelBooking(
  where: Prisma.BookingWhereUniqueInput,
  by: "visitor" | "business",
  reason?: string | null,
  actor?: { id: string; name: string } | null
): Promise<Booking> {
  const b = await loadForChange(where);
  if (b.status !== "confirmed") throw new BookingError("INVALID", "This booking is already cancelled or finished.");
  const updated = await db.booking.update({
    where: { id: b.id },
    data: { status: "cancelled", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason?.trim() || null, sequence: { increment: 1 } },
  });
  if (updated.leadId) {
    await db.leadActivity
      .create({
        data: {
          leadId: updated.leadId,
          businessId: b.businessId,
          type: "booking",
          description: `${by === "visitor" ? "Cancelled their" : "Cancelled the"} ${b.bookingType?.name ?? "booking"}`,
          metadata: JSON.stringify({ bookingId: b.id, startsAt: b.startsAt.toISOString(), reason: reason || undefined }),
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? null,
        },
      })
      .catch(() => {});
  }
  await afterChange("cancelled", updated, b.bookingType, b.business, { by });
  return updated;
}

export async function rescheduleBooking(where: Prisma.BookingWhereUniqueInput, start: Date, now = new Date()): Promise<Booking> {
  const b = await loadForChange(where);
  if (b.status !== "confirmed") throw new BookingError("INVALID", "This booking is already cancelled or finished.");
  if (!b.bookingType) throw new BookingError("CLOSED", "This booking can't be moved online. Please contact the business.");
  const type = b.bookingType;
  const rules = slotRulesFor(type, b.business.timezone);
  const endsAt = new Date(start.getTime() + type.durationMin * 60_000);

  const external = await externalAround(type, start, endsAt, { start: b.startsAt, end: b.endsAt });
  const updated = await db.$transaction(async (tx) => {
    await lockBusiness(tx, b.businessId);
    const busy = [...(await busyFor(tx, b.businessId, start, endsAt, b.id)), ...external];
    if (!isBookableSlot(rules, busy, start, now)) {
      throw new BookingError("SLOT_TAKEN", "Sorry, that time isn't available. Please pick another.");
    }
    return tx.booking.update({
      where: { id: b.id },
      data: { startsAt: start, endsAt, bufferMin: type.bufferMin, sequence: { increment: 1 } },
    });
  }, TX_OPTS);

  if (updated.leadId) {
    await db.leadActivity
      .create({
        data: {
          leadId: updated.leadId,
          businessId: b.businessId,
          type: "booking",
          description: `Moved their ${type.name}`,
          metadata: JSON.stringify({ bookingId: b.id, from: b.startsAt.toISOString(), to: start.toISOString() }),
        },
      })
      .catch(() => {});
  }
  await afterChange("rescheduled", updated, type, b.business, { by: "visitor" });
  return updated;
}

// ─── Calendly ─────────────────────────────────────────────────────────

/**
 * Record a Calendly webhook (invitee.created / invitee.canceled) as a
 * Danets booking. Idempotent: Calendly retries, and a repeat is ignored.
 * Calendly emails the invitee itself, so Danets sends no emails or
 * reminders for these; the team still gets the notification and the
 * automations run.
 */
export async function recordCalendlyBooking(businessId: string, invitee: CalendlyInvitee): Promise<{ bookingId: string; created: boolean } | null> {
  const existing = await db.booking.findUnique({ where: { businessId_externalId: { businessId, externalId: invitee.inviteeUri } } });

  if (invitee.event === "invitee.canceled") {
    if (!existing || existing.status !== "confirmed") return existing ? { bookingId: existing.id, created: false } : null;
    await cancelBooking({ id: existing.id }, invitee.canceledByInvitee ? "visitor" : "business", invitee.cancelReason ? `${invitee.cancelReason} (in Calendly)` : "Cancelled in Calendly");
    return { bookingId: existing.id, created: false };
  }
  if (existing) return { bookingId: existing.id, created: false };

  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, timezone: true } });
  if (!business) return null;
  const type = invitee.eventTypeUri
    ? await db.bookingType.findFirst({ where: { businessId, provider: "calendly", calendlyEventTypeUri: invitee.eventTypeUri } })
    : null;
  const typeName = type?.name ?? invitee.eventName ?? "Calendly meeting";
  // Calendly's questions aren't ours, so their answers go into the notes with
  // Calendly's wording (shown once in the dashboard, and as the lead's message).
  const notes = invitee.answers.length ? invitee.answers.map((qa) => `${qa.question}: ${qa.answer}`).join("\n") : null;

  let booking: Booking;
  try {
    booking = await db.booking.create({
      data: {
        businessId,
        bookingTypeId: type?.id ?? null,
        name: invitee.name,
        email: invitee.email,
        phone: invitee.phone,
        notes,
        startsAt: invitee.startsAt,
        endsAt: invitee.endsAt,
        bufferMin: 0,
        visitorTimezone: invitee.timezone,
        source: "calendly",
        cancelToken: newToken(),
        externalId: invitee.inviteeUri,
        externalProvider: "calendly",
        externalData: { cancelUrl: invitee.cancelUrl, rescheduleUrl: invitee.rescheduleUrl, eventUri: invitee.eventUri } as Prisma.InputJsonValue,
        meetingUrl: invitee.joinUrl,
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      const again = await db.booking.findUnique({ where: { businessId_externalId: { businessId, externalId: invitee.inviteeUri } } });
      return again ? { bookingId: again.id, created: false } : null;
    }
    throw e;
  }

  let leadId: string | null = null;
  let contactId: string | null = null;
  try {
    const utm = invitee.utm;
    const touch = Object.keys(utm).length ? { ...utm, landingUrl: null, referrer: null, at: new Date().toISOString() } : null;
    const inbound = await captureInbound({
      businessId,
      kind: "booking",
      attribution: touch ? { first: touch, last: touch } : undefined,
      profile: { name: booking.name, email: booking.email, phone: booking.phone },
      campaignId: type?.campaignId ?? null,
    });
    contactId = inbound?.contactId ?? null;
    leadId = await upsertLeadForBooking(
      booking,
      typeName,
      contactId,
      inbound ? { source: inbound.attributed ? leadSourceFromChannel(inbound.channel) : "website_form", firstTouchId: inbound.firstTouch.id, lastTouchId: inbound.touch.id } : null
    );
    if (leadId || contactId) await db.booking.update({ where: { id: booking.id }, data: { leadId, contactId } });
  } catch (e) {
    logger.error("calendly booking follow-up (lead/contact) failed", { bookingId: booking.id, ...serializeError(e) });
  }

  await afterChange("confirmed", { ...booking, leadId, contactId }, type, business);
  return { bookingId: booking.id, created: true };
}
