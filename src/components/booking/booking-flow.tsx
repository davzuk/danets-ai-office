"use client";

// The visitor's booking flow: pick a day, pick a time, give details, done.
// Used by the hosted page (/book/<pk>/<slug>) and, in "reschedule" mode, by
// the manage page. Times are shown in the visitor's own timezone.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Clock, Globe, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { zonedDateKey } from "@/lib/content/timezone";
import { addDaysKey } from "@/lib/booking/slots";

export interface PublicBookingType {
  slug: string;
  name: string;
  description: string | null;
  durationMin: number;
  locationLabel: string;
  questions: { key: string; label: string; required: boolean }[];
}

type Mode = { kind: "new" } | { kind: "reschedule"; token: string; currentStart: string };

interface Day {
  date: string;
  slots: string[];
}

const WINDOW_DAYS = 14;

function visitorTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const fmtDay = (key: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
};
const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const fmtFull = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Attribution for a booking made on this page: the link's UTM tags and referrer. */
function pageAttribution() {
  try {
    const q = new URLSearchParams(window.location.search);
    const touch = {
      source: q.get("utm_source"),
      medium: q.get("utm_medium"),
      campaign: q.get("utm_campaign"),
      term: q.get("utm_term"),
      content: q.get("utm_content"),
      referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : null,
      landingUrl: window.location.origin + window.location.pathname,
      at: new Date().toISOString(),
    };
    return { first: touch, last: touch };
  } catch {
    return undefined;
  }
}

function googleCalendarUrl(title: string, start: string, durationMin: number, details: string) {
  const s = new Date(start);
  const e = new Date(s.getTime() + durationMin * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const p = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(s)}/${stamp(e)}`, details });
  return `https://calendar.google.com/calendar/render?${p}`;
}

type FlowProps = Parameters<typeof BookingFlowInner>[0];

const noopSubscribe = () => () => {};

/**
 * Dates and times depend on the visitor's zone and locale, which the server
 * doesn't know, so the flow renders in the browser only (no hydration mismatch).
 */
export function BookingFlow(props: FlowProps) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!isClient) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading times" />
      </div>
    );
  }
  return <BookingFlowInner {...props} />;
}

function BookingFlowInner({
  pk,
  businessName,
  type,
  mode = { kind: "new" },
  prefill,
  onRescheduled,
}: {
  pk: string;
  businessName: string;
  type: PublicBookingType;
  mode?: Mode;
  prefill?: { name?: string; email?: string };
  onRescheduled?: (startsAt: string) => void;
}) {
  const [tz] = useState(visitorTz);
  const todayKey = useMemo(() => zonedDateKey(new Date(), tz), [tz]);
  const [windowStart, setWindowStart] = useState(todayKey);
  const [days, setDays] = useState<Day[] | null>(null);
  const [bookableUntil, setBookableUntil] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: prefill?.name ?? "", email: prefill?.email ?? "", phone: "", notes: "", website: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ startsAt: string; manageToken?: string } | null>(null);

  const load = useCallback(
    async (startKey: string) => {
      setDays(null);
      setLoadError(null);
      // The window's first and last day in the visitor's zone, as UTC instants (a day either side is fine: the server clips to what's bookable).
      const from = new Date(`${startKey}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 1);
      const to = new Date(`${addDaysKey(startKey, WINDOW_DAYS)}T00:00:00Z`);
      to.setUTCDate(to.getUTCDate() + 1);
      const q = new URLSearchParams({ pk, type: type.slug, from: from.toISOString(), to: to.toISOString(), tz });
      try {
        const r = await fetch(`/api/public/booking/slots?${q}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Could not load times.");
        const lastKey = addDaysKey(startKey, WINDOW_DAYS - 1);
        const inWindow = (data.days as Day[]).filter((d) => d.date >= startKey && d.date <= lastKey);
        setDays(inWindow);
        setBookableUntil(data.bookableUntil);
        setSelectedDay((cur) => (cur && inWindow.some((d) => d.date === cur) ? cur : inWindow[0]?.date ?? null));
      } catch (e: any) {
        setLoadError(e.message || "Could not load times.");
      }
    },
    [pk, type.slug, tz]
  );

  useEffect(() => {
    // Deferred so the first load's state updates land outside the effect body.
    const t = setTimeout(() => load(windowStart), 0);
    return () => clearTimeout(t);
  }, [load, windowStart]);

  const windowKeys = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => addDaysKey(windowStart, i)), [windowStart]);
  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d.slots])), [days]);
  const canGoBack = windowStart > todayKey;
  const canGoForward = !bookableUntil || addDaysKey(windowStart, WINDOW_DAYS) <= zonedDateKey(new Date(bookableUntil), tz);
  const daySlots = selectedDay ? byDate.get(selectedDay) ?? [] : [];

  async function submit() {
    if (!slot) return;
    setError(null);
    setSubmitting(true);
    try {
      if (mode.kind === "reschedule") {
        const r = await fetch("/api/public/bookings/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: mode.token, action: "reschedule", start: slot }),
        });
        const data = await r.json();
        if (!r.ok) throw Object.assign(new Error(data.error || "Could not move the booking."), { status: r.status });
        setDone({ startsAt: data.startsAt });
        onRescheduled?.(data.startsAt);
        return;
      }
      if (form.name.trim().length < 2) throw new Error("Please enter your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error("Please enter a valid email address.");
      for (const q of type.questions) {
        if (q.required && !answers[q.key]?.trim()) throw new Error(`Please answer: ${q.label}`);
      }
      const r = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pk,
          type: type.slug,
          start: slot,
          name: form.name,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
          answers,
          timezone: tz,
          source: "page",
          attribution: pageAttribution(),
          website: form.website,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Object.assign(new Error(data.error || "Could not book that time."), { status: r.status });
      setDone({ startsAt: data.startsAt, manageToken: data.manageToken });
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
      if (e.status === 409) {
        setSlot(null);
        load(windowStart);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4 py-6" role="status">
        <CalendarCheck className="h-12 w-12 mx-auto text-emerald-600" aria-hidden />
        <h2 className="text-xl font-semibold">{mode.kind === "reschedule" ? "Your booking has moved" : "You're booked"}</h2>
        <p className="text-muted-foreground">
          {type.name} with {businessName}
          <br />
          <span className="font-medium text-foreground">{fmtFull(done.startsAt, tz)}</span>
        </p>
        <p className="text-sm text-muted-foreground">A confirmation with a calendar invite is on its way to your email.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={googleCalendarUrl(`${type.name} with ${businessName}`, done.startsAt, type.durationMin, type.locationLabel)} target="_blank" rel="noopener noreferrer">
              Add to Google Calendar
            </a>
          </Button>
          {done.manageToken && (
            <Button asChild variant="ghost" size="sm">
              <a href={`/book/manage/${done.manageToken}`}>Reschedule or cancel</a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" aria-label="Earlier dates" disabled={!canGoBack} onClick={() => setWindowStart(addDaysKey(windowStart, -WINDOW_DAYS) < todayKey ? todayKey : addDaysKey(windowStart, -WINDOW_DAYS))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-medium" aria-live="polite">
          {fmtDay(windowKeys[0], { day: "numeric", month: "short" })} – {fmtDay(windowKeys[WINDOW_DAYS - 1], { day: "numeric", month: "short", year: "numeric" })}
        </div>
        <Button variant="outline" size="icon" aria-label="Later dates" disabled={!canGoForward} onClick={() => setWindowStart(addDaysKey(windowStart, WINDOW_DAYS))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          {loadError}{" "}
          <button className="underline" onClick={() => load(windowStart)}>
            Try again
          </button>
        </div>
      ) : !days ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading times" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Choose a day">
            {windowKeys.map((key) => {
              const has = (byDate.get(key)?.length ?? 0) > 0;
              const active = key === selectedDay;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!has}
                  aria-pressed={active}
                  aria-label={`${fmtDay(key, { weekday: "long", day: "numeric", month: "long" })}${has ? "" : ", no free times"}`}
                  onClick={() => {
                    setSelectedDay(key);
                    setSlot(null);
                  }}
                  className={`rounded-lg border px-1 py-2 text-center text-xs transition-colors ${
                    active ? "border-primary bg-primary text-primary-foreground" : has ? "hover:border-primary hover:bg-primary/5" : "opacity-40 cursor-not-allowed"
                  }`}
                >
                  <div>{fmtDay(key, { weekday: "short" })}</div>
                  <div className="text-base font-semibold leading-tight">{fmtDay(key, { day: "numeric" })}</div>
                </button>
              );
            })}
          </div>

          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No free times in these two weeks.{canGoForward ? " Try later dates." : ""}
            </p>
          ) : selectedDay ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">{fmtDay(selectedDay, { weekday: "long", day: "numeric", month: "long" })}</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" role="group" aria-label="Choose a time">
                {daySlots.map((s) => (
                  <Button key={s} type="button" variant={slot === s ? "default" : "outline"} size="sm" aria-pressed={slot === s} onClick={() => setSlot(s)}>
                    {fmtTime(s, tz)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" aria-hidden /> Times are in your timezone, {tz}.
          </p>
        </>
      )}

      {slot && (
        <div className="space-y-4 border-t pt-5">
          <div className="text-sm">
            <span className="text-muted-foreground">{mode.kind === "reschedule" ? "New time: " : "Selected: "}</span>
            <span className="font-medium">{fmtFull(slot, tz)}</span>
          </div>
          {mode.kind === "new" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bk-name">Your name *</Label>
                <Input id="bk-name" autoComplete="name" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-email">Email *</Label>
                <Input id="bk-email" type="email" autoComplete="email" value={form.email} maxLength={191} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-phone">Phone</Label>
                <Input id="bk-phone" type="tel" autoComplete="tel" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              {type.questions.map((q) => (
                <div key={q.key} className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`bk-q-${q.key}`}>
                    {q.label}
                    {q.required ? " *" : ""}
                  </Label>
                  <Input id={`bk-q-${q.key}`} value={answers[q.key] ?? ""} maxLength={1000} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
                </div>
              ))}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bk-notes">Anything we should know?</Label>
                <Textarea id="bk-notes" rows={3} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              {/* Honeypot: hidden from people, tempting to bots. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                </label>
              </div>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button onClick={submit} disabled={submitting} className="w-full sm:w-auto">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode.kind === "reschedule" ? "Move my booking" : "Confirm booking"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The left-hand summary of what's being booked. */
export function BookingSummary({ businessName, type }: { businessName: string; type: PublicBookingType }) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">{businessName}</div>
      <h1 className="text-2xl font-bold tracking-tight">{type.name}</h1>
      <div className="space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" aria-hidden /> {type.durationMin} minutes
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4" aria-hidden /> {type.locationLabel}
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4" aria-hidden /> Pick a time that suits you
        </div>
      </div>
      {type.description && <p className="text-sm whitespace-pre-line">{type.description}</p>}
    </div>
  );
}
