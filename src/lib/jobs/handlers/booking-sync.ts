import { z } from "zod";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import { OAuthGrantError } from "@/lib/connections/types";
import { cancelBooking } from "@/lib/booking/service";
import { calendarRefFor, syncAllowed } from "@/lib/booking/calendar-sync";
import { changedEvents, deletedEventIds } from "@/lib/booking/google-calendar";
import { defineJob } from "../define";

/** Re-read a little before the last run, in case an edit landed mid-run. */
const OVERLAP_MS = 5 * 60_000;
/** First run for a calendar looks back this far. */
const FIRST_LOOKBACK_MS = 60 * 60_000;

export const GOOGLE_REMOVED_REASON = "Removed from Google Calendar";

/**
 * Every 15 minutes: for each Google calendar used by a booking type, look at
 * events changed since the last run and cancel upcoming bookings whose event
 * was deleted there (the visitor is emailed as for any cancellation).
 * Moving an event in Google doesn't move the booking; move it in Danets.
 */
export const bookingSyncJob = defineJob({
  type: "booking.sync",
  schema: z.object({}),
  maxAttempts: 2,
  async handler() {
    const types = await db.bookingType.findMany({
      where: { provider: "google", calendarConnectionId: { not: null }, calendarId: { not: null } },
      select: { id: true, businessId: true, provider: true, calendarConnectionId: true, calendarId: true, calendarSyncedAt: true },
    });

    // One read per calendar, however many types share it.
    const calendars = new Map<string, { ref: NonNullable<ReturnType<typeof calendarRefFor>>; typeIds: string[]; since: Date | null }>();
    for (const t of types) {
      const ref = calendarRefFor(t);
      if (!ref) continue;
      const key = `${ref.businessId}|${ref.connectionId}|${ref.calendarId}`;
      const entry = calendars.get(key) ?? { ref, typeIds: [], since: t.calendarSyncedAt };
      entry.typeIds.push(t.id);
      if (!t.calendarSyncedAt || (entry.since && t.calendarSyncedAt < entry.since)) entry.since = t.calendarSyncedAt;
      calendars.set(key, entry);
    }

    const allowed = new Map<string, boolean>();
    for (const { ref, typeIds, since } of calendars.values()) {
      if (!allowed.has(ref.businessId)) allowed.set(ref.businessId, await syncAllowed(ref.businessId));
      if (!allowed.get(ref.businessId)) continue;

      const started = new Date();
      try {
        const events = await changedEvents(ref, since ? new Date(since.getTime() - OVERLAP_MS) : new Date(started.getTime() - FIRST_LOOKBACK_MS), started);
        const removed = deletedEventIds(events);
        if (removed.length) {
          const bookings = await db.booking.findMany({
            where: { businessId: ref.businessId, status: "confirmed", externalProvider: "google", externalId: { in: removed }, startsAt: { gt: started } },
            select: { id: true },
          });
          for (const b of bookings) {
            try {
              await cancelBooking({ id: b.id }, "business", GOOGLE_REMOVED_REASON);
              logger.info("booking cancelled: event removed in Google", { bookingId: b.id });
            } catch (e) {
              logger.warn("could not cancel booking removed in Google", { bookingId: b.id, ...serializeError(e) });
            }
          }
        }
        await db.bookingType.updateMany({ where: { id: { in: typeIds } }, data: { calendarSyncedAt: started } });
      } catch (e) {
        // A lapsed connection is already flagged to the tenant; try again next run.
        if (e instanceof ConnectionUnavailableError || e instanceof OAuthGrantError) continue;
        logger.error("booking calendar sync failed", { businessId: ref.businessId, calendarId: ref.calendarId, ...serializeError(e) });
      }
    }
  },
});
