// Calendar sync glue between bookings and Google Calendar (P part 2).
// Sync is best effort: if Google is down or the connection lapsed, booking
// keeps working on Danets data alone and the failure is logged.

import type { Booking, BookingType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isModuleEnabled } from "@/lib/module-access";
import { logger, serializeError } from "@/lib/logger";
import { deleteEvent, googleBusy, insertEvent, moveEvent, withoutOwnEvent, type CalendarRef } from "./google-calendar";
import { LOCATION_LABEL, type Busy } from "./slots";

type TypeRef = Pick<BookingType, "businessId" | "provider" | "calendarConnectionId" | "calendarId">;

/** The type's Google calendar, when it is set up to use one. */
export function calendarRefFor(type: TypeRef | null | undefined): CalendarRef | null {
  if (!type || type.provider !== "google" || !type.calendarConnectionId || !type.calendarId) return null;
  return { connectionId: type.calendarConnectionId, businessId: type.businessId, calendarId: type.calendarId };
}

/** Calendar sync is a Pro feature; a downgraded tenant falls back to Danets only. */
export async function syncAllowed(businessId: string): Promise<boolean> {
  return isModuleEnabled(businessId, "booking_sync");
}

/**
 * Busy times from the type's Google calendar around a range. Fails open
 * (no extra busy times) so a Google outage never stops bookings.
 */
export async function externalBusy(type: TypeRef, from: Date, to: Date, own?: { start: Date; end: Date } | null): Promise<Busy[]> {
  const ref = calendarRefFor(type);
  if (!ref || !(await syncAllowed(type.businessId))) return [];
  try {
    return withoutOwnEvent(await googleBusy(ref, from, to), own);
  } catch (e) {
    logger.warn("google free/busy unavailable; using Danets bookings only", { businessId: type.businessId, ...serializeError(e) });
    return [];
  }
}

interface GoogleExternal {
  connectionId: string;
  calendarId: string;
}

function readGoogleExternal(b: Pick<Booking, "externalProvider" | "externalData">): GoogleExternal | null {
  if (b.externalProvider !== "google") return null;
  const d = b.externalData as Partial<GoogleExternal> | null;
  return d?.connectionId && d.calendarId ? { connectionId: d.connectionId, calendarId: d.calendarId } : null;
}

/**
 * Mirror a booking change into Google Calendar: add the event on a new
 * booking, move it on a reschedule, remove it on a cancellation. Returns
 * the booking as updated (event id, Meet link). Never throws.
 */
export async function pushBookingEvent(
  kind: "confirmed" | "rescheduled" | "cancelled",
  booking: Booking,
  type: (TypeRef & Pick<BookingType, "name" | "location" | "locationDetail">) | null,
  businessName: string
): Promise<Booking> {
  try {
    const existing = readGoogleExternal(booking);
    if (kind === "cancelled") {
      // The event may have been deleted in Google already (that's how the sync cancels).
      if (existing && booking.externalId) {
        await deleteEvent({ ...existing, businessId: booking.businessId }, booking.externalId);
      }
      return booking;
    }
    if (kind === "rescheduled" && existing && booking.externalId) {
      await moveEvent({ ...existing, businessId: booking.businessId }, booking.externalId, booking.startsAt, booking.endsAt);
      return booking;
    }

    const ref = calendarRefFor(type);
    if (!ref || !type || !(await syncAllowed(booking.businessId))) return booking;
    const where = type.location === "video" ? null : [LOCATION_LABEL[type.location] ?? type.location, type.locationDetail].filter(Boolean).join(": ");
    const event = await insertEvent(ref, {
      bookingId: booking.id,
      summary: `${type.name}: ${booking.name}`,
      description: [
        `Booked through ${businessName}'s booking page.`,
        `Name: ${booking.name}`,
        `Email: ${booking.email}`,
        booking.phone ? `Phone: ${booking.phone}` : "",
        booking.notes ? `Notes: ${booking.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      start: booking.startsAt,
      end: booking.endsAt,
      attendee: { name: booking.name, email: booking.email },
      location: where,
      // A video booking without a fixed link gets a Meet link.
      meet: type.location === "video" && !type.locationDetail,
    });
    return await db.booking.update({
      where: { id: booking.id },
      data: {
        externalId: event.id,
        externalProvider: "google",
        externalData: { connectionId: ref.connectionId, calendarId: ref.calendarId } as Prisma.InputJsonValue,
        meetingUrl: event.hangoutLink ?? null,
      },
    });
  } catch (e) {
    logger.error("google calendar event not updated", { bookingId: booking.id, kind, ...serializeError(e) });
    return booking;
  }
}
