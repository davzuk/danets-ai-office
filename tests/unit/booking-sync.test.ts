import { describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/activity", () => ({ createNotification: vi.fn(), logActivity: vi.fn() }));

const { verifyCalendlySignature, parseCalendlyWebhook, calendlyEmbedUrl, isCalendlyUrl } = await import("@/lib/booking/calendly");
const { hasCalendarScopes, withoutOwnEvent, deletedEventIds, GOOGLE_CALENDAR_SCOPES } = await import("@/lib/booking/google-calendar");
const { googleProvider, GOOGLE_DEFAULT_SCOPES } = await import("@/lib/connections/providers/google");
const { createOAuthState, verifyOAuthState } = await import("@/lib/connections/state");
const { SCHEDULES } = await import("@/lib/jobs/schedules");
const { fillBookingReminder } = await import("@/lib/booking/whatsapp-reminder");
const { bookingPageUrl } = await import("@/lib/booking/link-email");

const sign = (body: string, key: string, t: number) => `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;

describe("Calendly webhook signature", () => {
  const key = "signing-key";
  const body = JSON.stringify({ event: "invitee.created" });
  const now = 1_800_000_000_000;
  const t = Math.floor(now / 1000);

  it("accepts a fresh, correct signature", () => {
    expect(verifyCalendlySignature(sign(body, key, t), body, key, now)).toBe(true);
  });
  it("rejects a wrong key, a changed body, a stale time or a missing header", () => {
    expect(verifyCalendlySignature(sign(body, "other", t), body, key, now)).toBe(false);
    expect(verifyCalendlySignature(sign(body, key, t), body + " ", key, now)).toBe(false);
    expect(verifyCalendlySignature(sign(body, key, t - 600), body, key, now)).toBe(false);
    expect(verifyCalendlySignature(null, body, key, now)).toBe(false);
    expect(verifyCalendlySignature("t=abc,v1=zz", body, key, now)).toBe(false);
  });
});

describe("parseCalendlyWebhook", () => {
  const payload = {
    uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
    name: "Ada Okafor",
    email: "Ada@Example.com",
    timezone: "Europe/London",
    text_reminder_number: "+447700900000",
    cancel_url: "https://calendly.com/cancellations/I1",
    reschedule_url: "https://calendly.com/reschedulings/I1",
    questions_and_answers: [
      { question: "Company", answer: "Acme" },
      { question: "Empty", answer: "" },
    ],
    tracking: { utm_source: "google", utm_campaign: "spring", utm_medium: null },
    scheduled_event: {
      uri: "https://api.calendly.com/scheduled_events/E1",
      name: "30 Minute Meeting",
      event_type: "https://api.calendly.com/event_types/T1",
      start_time: "2026-12-01T10:00:00.000000Z",
      end_time: "2026-12-01T10:30:00.000000Z",
      location: { type: "google_conference", join_url: "https://meet.google.com/abc-defg-hij" },
    },
  };

  it("reads a created invitee", () => {
    const inv = parseCalendlyWebhook({ event: "invitee.created", payload });
    expect(inv).toMatchObject({
      event: "invitee.created",
      email: "ada@example.com",
      name: "Ada Okafor",
      phone: "+447700900000",
      eventTypeUri: "https://api.calendly.com/event_types/T1",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      utm: { source: "google", campaign: "spring" },
      answers: [{ question: "Company", answer: "Acme" }],
      canceledByInvitee: false,
    });
    expect(inv?.startsAt.toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });

  it("reads a cancellation and who cancelled", () => {
    const inv = parseCalendlyWebhook({ event: "invitee.canceled", payload: { ...payload, cancellation: { reason: "Clash", canceler_type: "invitee" } } });
    expect(inv).toMatchObject({ event: "invitee.canceled", cancelReason: "Clash", canceledByInvitee: true });
  });

  it("ignores other events and incomplete payloads", () => {
    expect(parseCalendlyWebhook({ event: "routing_form_submission.created", payload })).toBeNull();
    expect(parseCalendlyWebhook({ event: "invitee.created", payload: { ...payload, email: "" } })).toBeNull();
    expect(parseCalendlyWebhook({ event: "invitee.created", payload: { ...payload, scheduled_event: {} } })).toBeNull();
    expect(parseCalendlyWebhook(null)).toBeNull();
  });
});

describe("Calendly links", () => {
  it("accepts only https calendly.com links with a path", () => {
    expect(isCalendlyUrl("https://calendly.com/acme/30min")).toBe(true);
    expect(isCalendlyUrl("https://calendly.com/")).toBe(false);
    expect(isCalendlyUrl("http://calendly.com/acme")).toBe(false);
    expect(isCalendlyUrl("https://calendly.com.evil.test/acme")).toBe(false);
    expect(isCalendlyUrl("not a url")).toBe(false);
  });

  it("builds the inline embed URL with prefill and UTM tags", () => {
    const u = new URL(calendlyEmbedUrl("https://calendly.com/acme/30min", { embedDomain: "app.example.com", name: "Ada", email: "ada@example.com", utm: { source: "widget", campaign: null } }));
    expect(u.searchParams.get("embed_type")).toBe("Inline");
    expect(u.searchParams.get("embed_domain")).toBe("app.example.com");
    expect(u.searchParams.get("name")).toBe("Ada");
    expect(u.searchParams.get("email")).toBe("ada@example.com");
    expect(u.searchParams.get("utm_source")).toBe("widget");
    expect(u.searchParams.has("utm_campaign")).toBe(false);
  });
});

describe("Google Calendar helpers", () => {
  it("knows when calendar access was granted", () => {
    expect(hasCalendarScopes(GOOGLE_CALENDAR_SCOPES)).toBe(true);
    expect(hasCalendarScopes(GOOGLE_CALENDAR_SCOPES.join(" "))).toBe(true);
    expect(hasCalendarScopes("openid email https://www.googleapis.com/auth/calendar")).toBe(true);
    expect(hasCalendarScopes(GOOGLE_DEFAULT_SCOPES)).toBe(false);
    expect(hasCalendarScopes(GOOGLE_CALENDAR_SCOPES.slice(1))).toBe(false);
  });

  it("drops only the booking's own busy block", () => {
    const own = { start: new Date("2026-12-01T10:00:00Z"), end: new Date("2026-12-01T10:30:00Z") };
    const other = { start: new Date("2026-12-01T11:00:00Z"), end: new Date("2026-12-01T12:00:00Z") };
    expect(withoutOwnEvent([own, other], own)).toEqual([other]);
    expect(withoutOwnEvent([own, other], null)).toEqual([own, other]);
  });

  it("lists deleted events", () => {
    expect(deletedEventIds([{ id: "a", status: "cancelled" }, { id: "b", status: "confirmed" }] as never)).toEqual(["a"]);
  });

  it("adds calendar scopes to the consent URL without dropping the defaults", () => {
    const env = { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs", NEXT_PUBLIC_APP_URL: "https://app.example.com" };
    const url = new URL(googleProvider.authorizeUrl({ state: "st", redirectUri: "https://cb", env, extraScopes: GOOGLE_CALENDAR_SCOPES }));
    const scope = url.searchParams.get("scope")!.split(" ");
    for (const s of [...GOOGLE_DEFAULT_SCOPES, ...GOOGLE_CALENDAR_SCOPES]) expect(scope).toContain(s);
    expect(new Set(scope).size).toBe(scope.length);
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("carries the connect purpose through the OAuth state", () => {
    const who = { provider: "google" as const, businessId: "biz_1", userId: "user_1" };
    const s = createOAuthState({ ...who, pkce: false, purpose: "calendar" });
    const check = verifyOAuthState({ ...who, cookieValue: s.cookieValue, state: s.state });
    expect(check.ok && check.payload.purpose).toBe("calendar");
    const plain = createOAuthState({ ...who, pkce: false });
    const c2 = verifyOAuthState({ ...who, cookieValue: plain.cookieValue, state: plain.state });
    expect(c2.ok && c2.payload.purpose).toBeUndefined();
  });

  it("schedules the sync job", () => {
    expect(SCHEDULES.some((s) => s.job.type === "booking.sync")).toBe(true);
  });
});

describe("booking reminders and links", () => {
  it("fills the WhatsApp reminder placeholders", () => {
    const text = fillBookingReminder("Hi {name}, your {service} with {company} is at {time}. Change it: {link} {other}", {
      name: "Ada Okafor",
      typeName: "Consultation",
      businessName: "Acme",
      startsAt: new Date("2026-12-01T10:00:00Z"),
      visitorTimezone: "Europe/London",
      businessTimezone: "UTC",
      manageUrl: "https://app.example.com/book/manage/tok",
    });
    expect(text).toContain("Hi Ada,");
    expect(text).toContain("Consultation with Acme");
    expect(text).toContain("10:00");
    expect(text).toContain("(Europe/London)");
    expect(text).toContain("https://app.example.com/book/manage/tok");
    expect(text).toContain("{other}");
  });

  it("prefills the hosted booking link", () => {
    const u = new URL(bookingPageUrl("pk 1", "intro-call", { name: "Ada O", email: "ada@example.com" }));
    expect(u.pathname).toBe("/book/pk%201/intro-call");
    expect(u.searchParams.get("name")).toBe("Ada O");
    expect(u.searchParams.get("email")).toBe("ada@example.com");
  });
});
