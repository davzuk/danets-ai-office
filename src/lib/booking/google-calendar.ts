// Google Calendar for bookings (Phase 2, workstream P part 2): busy times
// from a tenant's calendar, and booking events written to it. Uses the
// tenant's Google connection; the Calendar scopes are added by incremental
// consent only when they turn calendar sync on.

import { getAccessToken } from "@/lib/connections/tokens";
import { providerFetch } from "@/lib/connections/http";
import { OAuthProviderError } from "@/lib/connections/types";
import type { Busy } from "./slots";

const API = "https://www.googleapis.com/calendar/v3";

/** Asked for only when a tenant connects a calendar for bookings. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
];

/** Does this connection's grant cover calendar sync? */
export function hasCalendarScopes(scopes: string | string[]): boolean {
  const granted = new Set(Array.isArray(scopes) ? scopes : scopes.split(" "));
  // The broad calendar scope covers all three.
  if (granted.has("https://www.googleapis.com/auth/calendar")) return true;
  return GOOGLE_CALENDAR_SCOPES.every((s) => granted.has(s));
}

export interface CalendarRef {
  connectionId: string;
  businessId: string;
  calendarId: string;
}

async function call<T>(ref: Pick<CalendarRef, "connectionId" | "businessId">, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(ref.connectionId, ref.businessId);
  return providerFetch<T>(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const cal = (id: string) => encodeURIComponent(id);

export interface GoogleCalendarSummary {
  id: string;
  name: string;
  primary: boolean;
}

/** Calendars the connected account can add events to. */
export async function listWritableCalendars(ref: Pick<CalendarRef, "connectionId" | "businessId">): Promise<GoogleCalendarSummary[]> {
  const r = await call<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[] }>(
    ref,
    "/users/me/calendarList?minAccessRole=writer&maxResults=250"
  );
  return (r.items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary }));
}

/** Busy periods in the calendar between two instants. */
export async function googleBusy(ref: CalendarRef, from: Date, to: Date): Promise<Busy[]> {
  const r = await call<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> }>(ref, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: ref.calendarId }] }),
  });
  const entry = r.calendars?.[ref.calendarId];
  if (entry?.errors?.length) throw new OAuthProviderError(`Calendar unavailable: ${entry.errors.map((e) => e.reason).join(", ")}`);
  return (entry?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export interface EventInput {
  bookingId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendee: { name: string; email: string };
  location?: string | null;
  /** Ask Google to add a Meet link. */
  meet: boolean;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  updated?: string;
}

/**
 * Add the booking to the calendar. Google doesn't email the attendee
 * (sendUpdates=none): the visitor already has our email and invite.
 */
export async function insertEvent(ref: CalendarRef, e: EventInput): Promise<GoogleEvent> {
  const body = {
    summary: e.summary,
    description: e.description,
    location: e.location || undefined,
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    attendees: [{ email: e.attendee.email, displayName: e.attendee.name }],
    extendedProperties: { private: { danetsBookingId: e.bookingId } },
    ...(e.meet ? { conferenceData: { createRequest: { requestId: `danets-${e.bookingId}`, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
  return call<GoogleEvent>(ref, `/calendars/${cal(ref.calendarId)}/events?sendUpdates=none${e.meet ? "&conferenceDataVersion=1" : ""}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function moveEvent(ref: CalendarRef, eventId: string, start: Date, end: Date): Promise<GoogleEvent> {
  return call<GoogleEvent>(ref, `/calendars/${cal(ref.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: "PATCH",
    body: JSON.stringify({ start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } }),
  });
}

/** Remove the event; one that's already gone is fine. */
export async function deleteEvent(ref: CalendarRef, eventId: string): Promise<void> {
  try {
    await call(ref, `/calendars/${cal(ref.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE" });
  } catch (e) {
    if (e instanceof OAuthProviderError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

/** Google rejects updatedMin older than about four weeks (410). */
export const MAX_SYNC_LOOKBACK_MS = 20 * 24 * 3_600_000;

/**
 * Events changed since `since`, including deleted ones (status "cancelled").
 * Pages through every result.
 */
export async function changedEvents(ref: CalendarRef, since: Date, now = new Date()): Promise<GoogleEvent[]> {
  const floor = new Date(now.getTime() - MAX_SYNC_LOOKBACK_MS);
  const updatedMin = since < floor ? floor : since;
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ updatedMin: updatedMin.toISOString(), showDeleted: "true", singleEvents: "true", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await call<{ items?: GoogleEvent[]; nextPageToken?: string }>(ref, `/calendars/${cal(ref.calendarId)}/events?${q}`);
    out.push(...(r.items ?? []));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Bookings whose event was deleted in Google, given the changed events. */
export function deletedEventIds(events: GoogleEvent[]): string[] {
  return events.filter((e) => e.status === "cancelled").map((e) => e.id);
}

/**
 * Leave out the busy block that is the booking's own event (when moving a
 * booking, its current time shouldn't block nearby times).
 */
export function withoutOwnEvent(busy: Busy[], own?: { start: Date; end: Date } | null): Busy[] {
  if (!own) return busy;
  return busy.filter((b) => !(b.start.getTime() === own.start.getTime() && b.end.getTime() === own.end.getTime()));
}
