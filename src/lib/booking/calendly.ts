// Calendly for bookings (Phase 2, workstream P part 2).
//
// A booking type can hand scheduling to Calendly: the hosted page embeds the
// tenant's Calendly link. With a Calendly personal access token (paid
// Calendly plans), a webhook tells us about each booking so it becomes a
// Danets Booking and Lead as well. The pure helpers here (embed URL,
// signature check, payload mapping) are unit-tested.

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.calendly.com";
const TIMEOUT_MS = 15_000;

/** A public Calendly scheduling link, e.g. https://calendly.com/acme/30min. */
export function isCalendlyUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "calendly.com" || u.hostname.endsWith(".calendly.com")) && u.pathname.length > 1;
  } catch {
    return false;
  }
}

/** The inline-embed URL with the visitor's details and UTM tags prefilled. */
export function calendlyEmbedUrl(
  link: string,
  opts: { embedDomain?: string; name?: string | null; email?: string | null; utm?: Partial<Record<"source" | "medium" | "campaign" | "term" | "content", string | null>> } = {}
): string {
  const u = new URL(link);
  u.searchParams.set("embed_type", "Inline");
  if (opts.embedDomain) u.searchParams.set("embed_domain", opts.embedDomain);
  u.searchParams.set("hide_gdpr_banner", "1");
  if (opts.name) u.searchParams.set("name", opts.name);
  if (opts.email) u.searchParams.set("email", opts.email);
  for (const [k, v] of Object.entries(opts.utm ?? {})) if (v) u.searchParams.set(`utm_${k}`, v);
  return u.toString();
}

export class CalendlyError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "CalendlyError";
  }
}

async function calendly<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new CalendlyError(`Couldn't reach Calendly: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) throw new CalendlyError(body?.message || body?.title || `Calendly returned ${res.status}`, res.status);
  return body as T;
}

export interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  organization: string;
  schedulingUrl: string;
}

export async function calendlyMe(token: string): Promise<CalendlyUser> {
  const r = await calendly<{ resource: { uri: string; name: string; email: string; current_organization: string; scheduling_url: string } }>(token, "/users/me");
  return { uri: r.resource.uri, name: r.resource.name, email: r.resource.email, organization: r.resource.current_organization, schedulingUrl: r.resource.scheduling_url };
}

export interface CalendlyEventType {
  uri: string;
  name: string;
  schedulingUrl: string;
  durationMin: number;
}

export async function calendlyEventTypes(token: string, userUri: string): Promise<CalendlyEventType[]> {
  const q = new URLSearchParams({ user: userUri, active: "true", count: "100" });
  const r = await calendly<{ collection: { uri: string; name: string; scheduling_url: string; duration: number }[] }>(token, `/event_types?${q}`);
  return r.collection.map((e) => ({ uri: e.uri, name: e.name, schedulingUrl: e.scheduling_url, durationMin: e.duration }));
}

/** Webhooks need a paid Calendly plan; on a free plan this fails with 403. */
export async function createCalendlyWebhook(token: string, args: { url: string; user: CalendlyUser; signingKey: string }): Promise<string> {
  const r = await calendly<{ resource: { uri: string } }>(token, "/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url: args.url,
      events: ["invitee.created", "invitee.canceled"],
      organization: args.user.organization,
      user: args.user.uri,
      scope: "user",
      signing_key: args.signingKey,
    }),
  });
  return r.resource.uri;
}

export async function deleteCalendlyWebhook(token: string, uri: string): Promise<void> {
  try {
    await calendly(token, uri, { method: "DELETE" });
  } catch (e) {
    if (e instanceof CalendlyError && e.status === 404) return;
    throw e;
  }
}

/** Calendly-Webhook-Signature: "t=<unix secs>,v1=<hex HMAC-SHA256 of `${t}.${body}`>". */
export function verifyCalendlySignature(header: string | null, rawBody: string, signingKey: string, nowMs = Date.now(), toleranceMs = 5 * 60_000): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;
  if (Math.abs(nowMs - t * 1000) > toleranceMs) return false;
  const expected = createHmac("sha256", signingKey).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface CalendlyInvitee {
  event: "invitee.created" | "invitee.canceled";
  inviteeUri: string;
  name: string;
  email: string;
  phone: string | null;
  timezone: string | null;
  startsAt: Date;
  endsAt: Date;
  eventTypeUri: string | null;
  eventName: string | null;
  eventUri: string | null;
  joinUrl: string | null;
  cancelUrl: string | null;
  rescheduleUrl: string | null;
  answers: { question: string; answer: string }[];
  utm: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  cancelReason: string | null;
  canceledByInvitee: boolean;
}

const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A webhook body as a booking, or null when it isn't one we handle. */
export function parseCalendlyWebhook(body: unknown): CalendlyInvitee | null {
  const b = body as { event?: string; payload?: Record<string, any> } | null;
  if (!b || (b.event !== "invitee.created" && b.event !== "invitee.canceled")) return null;
  const p = b.payload ?? {};
  const ev = p.scheduled_event ?? {};
  const email = str(p.email, 191);
  const uri = str(p.uri, 191);
  const start = new Date(ev.start_time);
  const end = new Date(ev.end_time);
  if (!email || !uri || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const tracking = p.tracking ?? {};
  const utm = Object.fromEntries(
    (["source", "medium", "campaign", "term", "content"] as const).map((k) => [k, str(tracking[`utm_${k}`], 200)]).filter(([, v]) => v)
  );
  return {
    event: b.event,
    inviteeUri: uri,
    name: str(p.name, 100) ?? email,
    email: email.toLowerCase(),
    phone: str(p.text_reminder_number, 40),
    timezone: str(p.timezone, 64),
    startsAt: start,
    endsAt: end,
    eventTypeUri: str(ev.event_type, 255),
    eventName: str(ev.name, 120),
    eventUri: str(ev.uri, 255),
    joinUrl: str(ev.location?.join_url, 1000),
    cancelUrl: str(p.cancel_url, 1000),
    rescheduleUrl: str(p.reschedule_url, 1000),
    answers: (Array.isArray(p.questions_and_answers) ? p.questions_and_answers : [])
      .map((qa: any) => ({ question: str(qa?.question, 120) ?? "", answer: str(qa?.answer, 1000) ?? "" }))
      .filter((qa: { question: string; answer: string }) => qa.question && qa.answer)
      .slice(0, 10),
    utm,
    cancelReason: str(p.cancellation?.reason, 500),
    canceledByInvitee: p.cancellation?.canceler_type === "invitee",
  };
}
