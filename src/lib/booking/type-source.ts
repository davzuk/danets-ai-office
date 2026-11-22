// Where a booking type's times come from (native, Google Calendar,
// Calendly): validation shared by the create and edit routes.

import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { isModuleEnabled } from "@/lib/module-access";
import { logger, serializeError } from "@/lib/logger";
import type { BookingTypeInput } from "./slots";
import { hasCalendarScopes, listWritableCalendars } from "./google-calendar";
import { isCalendlyUrl } from "./calendly";
import { listCalendlyEventTypes, sameCalendlyLink } from "./calendly-connection";

export interface SourceFields {
  provider: "native" | "google" | "calendly";
  calendarConnectionId: string | null;
  calendarId: string | null;
  calendlyUrl: string | null;
  calendlyEventTypeUri: string | null;
}

/**
 * Check the source settings and return the columns to store. Google needs
 * the Pro sync module and a calendar the connected account can write to;
 * a Calendly link works on any plan (recording its bookings needs Pro and
 * a Calendly connection, matched here by the link).
 */
export async function resolveSource(businessId: string, d: BookingTypeInput, before?: { provider: string; calendarConnectionId: string | null; calendarId: string | null }): Promise<SourceFields> {
  if (d.provider === "google") {
    if (!(await isModuleEnabled(businessId, "booking_sync"))) {
      throw new AppError("Google Calendar sync needs the Pro plan.", { status: 403, code: "MODULE_DISABLED" });
    }
    const connectionId = d.calendarConnectionId ?? "";
    const calendarId = d.calendarId?.trim() ?? "";
    if (!connectionId || !calendarId) throw new AppError("Choose a Google account and calendar.", { status: 400, code: "INVALID_INPUT" });
    const conn = await db.oAuthConnection.findFirst({ where: { id: connectionId, businessId, provider: "google" }, select: { id: true, scopes: true, status: true } });
    if (!conn || conn.status !== "active" || !hasCalendarScopes(conn.scopes)) {
      throw new AppError("That Google account can't be used for calendars. Connect Google Calendar again.", { status: 400, code: "INVALID_INPUT" });
    }
    // Unchanged settings aren't re-checked with Google (saves a call on every edit).
    const unchanged = before?.provider === "google" && before.calendarConnectionId === connectionId && before.calendarId === calendarId;
    if (!unchanged) {
      try {
        const calendars = await listWritableCalendars({ connectionId, businessId });
        if (!calendars.some((c) => c.id === calendarId)) {
          throw new AppError("That calendar isn't one this Google account can add events to.", { status: 400, code: "INVALID_INPUT" });
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError("Couldn't reach Google Calendar to check the calendar. Try again.", { status: 502, code: "PROVIDER_ERROR" });
      }
    }
    return { provider: "google", calendarConnectionId: connectionId, calendarId, calendlyUrl: null, calendlyEventTypeUri: null };
  }

  if (d.provider === "calendly") {
    const url = d.calendlyUrl?.trim() ?? "";
    if (!isCalendlyUrl(url)) throw new AppError("Paste your Calendly scheduling link, e.g. https://calendly.com/you/30min.", { status: 400, code: "INVALID_INPUT" });
    let eventTypeUri: string | null = null;
    try {
      const types = await listCalendlyEventTypes(businessId);
      eventTypeUri = types.find((t) => sameCalendlyLink(t.schedulingUrl, url))?.uri ?? null;
    } catch (e) {
      logger.warn("calendly event types unavailable; link saved without a match", { businessId, ...serializeError(e) });
    }
    return { provider: "calendly", calendarConnectionId: null, calendarId: null, calendlyUrl: url, calendlyEventTypeUri: eventTypeUri };
  }

  return { provider: "native", calendarConnectionId: null, calendarId: null, calendlyUrl: null, calendlyEventTypeUri: null };
}
