"use client";

// Calendar connections for bookings (Pro): Google Calendar accounts and the
// Calendly connection, plus the "where times come from" picker used by the
// booking type editor.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SyncData {
  canEdit: boolean;
  google: {
    configured: boolean;
    accounts: {
      id: string;
      name: string;
      email: string | null;
      status: string;
      calendarReady: boolean;
    }[];
  };
  calendly: {
    connected: boolean;
    name?: string;
    email?: string;
    schedulingUrl?: string;
    tokenMasked?: string;
    webhook: "active" | "unavailable" | "none";
    webhookError?: string | null;
  };
}

/** null while loading; "locked" below Pro; otherwise the connections. */
export type SyncState = SyncData | "locked" | null;

export async function loadSync(): Promise<SyncState> {
  try {
    const r = await fetch("/api/booking-sync", { cache: "no-store" });
    if (r.status === 403) return "locked";
    if (!r.ok) return "locked";
    return (await r.json()) as SyncData;
  } catch {
    return "locked";
  }
}

export function CalendarConnections({
  sync,
  onChanged,
}: {
  sync: SyncState;
  onChanged: () => void;
}) {
  if (sync === null) return null;
  if (sync === "locked") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">Calendar sync is on the Pro plan</p>
          <p className="text-xs text-muted-foreground">
            Check Google Calendar for busy times, add bookings to it with a Meet
            link, and record bookings made in Calendly. You can still link a
            Calendly page to a booking type on any plan.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Calendar connections</h3>
      </div>
      <GoogleSection sync={sync} />
      <CalendlySection sync={sync} onChanged={onChanged} />
    </div>
  );
}

function GoogleSection({ sync }: { sync: SyncData }) {
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try {
      const r = await fetch("/api/connections/google/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "calendar" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url)
        throw new Error(d.error || "Could not start the Google connection.");
      window.location.assign(d.url);
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  }
  const ready = sync.google.accounts.filter((a) => a.calendarReady);
  return (
    <div className="space-y-1.5 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Google Calendar</p>
          <p className="text-xs text-muted-foreground">
            Busy times block slots, and each booking is added to the calendar
            (with a Meet link for video calls).
          </p>
        </div>
        {sync.canEdit && sync.google.configured && (
          <Button size="sm" variant="outline" onClick={connect} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {ready.length
              ? "Connect another account"
              : sync.google.accounts.length
                ? "Allow calendar access"
                : "Connect Google Calendar"}
          </Button>
        )}
      </div>
      {!sync.google.configured && (
        <p className="text-xs text-muted-foreground">
          Google sign-in isn&apos;t set up on this server yet. Ask your
          administrator to add the Google OAuth credentials.
        </p>
      )}
      {sync.google.accounts.length > 0 && (
        <ul className="space-y-1">
          {sync.google.accounts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span>{a.email ?? a.name}</span>
              {a.calendarReady ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                >
                  Ready
                </Badge>
              ) : a.status !== "active" ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/30 text-amber-700 dark:text-amber-400"
                >
                  Needs reconnecting
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  No calendar access
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CalendlySection({
  sync,
  onChanged,
}: {
  sync: SyncData;
  onChanged: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const c = sync.calendly;

  async function connect() {
    setBusy(true);
    try {
      const r = await fetch("/api/booking-sync/calendly", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not connect Calendly.");
      setToken("");
      toast.success(
        d.calendly?.webhook === "active"
          ? "Calendly connected. New bookings will appear here."
          : "Calendly connected, but bookings won't sync yet.",
      );
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      const r = await fetch("/api/booking-sync/calendly", { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not disconnect Calendly.");
      toast.success("Calendly disconnected.");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 border-t pt-3">
      <p className="text-sm font-medium">Calendly</p>
      {c.connected ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{c.email ?? c.name ?? "Connected"}</span>
            {c.webhook === "active" ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              >
                Syncing bookings
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/30 text-amber-700 dark:text-amber-400"
              >
                Not syncing bookings
              </Badge>
            )}
            {sync.canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-destructive"
                onClick={disconnect}
                disabled={busy}
              >
                Disconnect
              </Button>
            )}
          </div>
          {c.webhookError && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {c.webhookError}
            </p>
          )}
          {c.tokenMasked && (
            <p className="text-xs text-muted-foreground">
              Token {c.tokenMasked}
            </p>
          )}
        </div>
      ) : sync.canEdit ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Paste a personal access token (Calendly: Integrations, then API and
            webhooks) so bookings made in Calendly show up here. Recording
            bookings needs a paid Calendly plan.
          </p>
          <div className="flex gap-2">
            <Label htmlFor="cal-token" className="sr-only">
              Calendly personal access token
            </Label>
            <Input
              id="cal-token"
              type="password"
              autoComplete="off"
              className="h-8"
              placeholder="Personal access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button
              size="sm"
              onClick={connect}
              disabled={busy || token.trim().length < 20}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Not connected. An admin can connect it.
        </p>
      )}
    </div>
  );
}

export type Provider = "native" | "google" | "calendly";

export interface SourceDraft {
  provider: Provider;
  calendarConnectionId: string | null;
  calendarId: string | null;
  calendlyUrl: string | null;
}

/** The "where times come from" choice in the booking type editor. */
export function SourcePicker({
  value,
  onChange,
  sync,
}: {
  value: SourceDraft;
  onChange: (v: SourceDraft) => void;
  sync: SyncState;
}) {
  const googleAccounts =
    sync && sync !== "locked"
      ? sync.google.accounts.filter(
          (a) => a.calendarReady || a.id === value.calendarConnectionId,
        )
      : [];
  const googleAllowed = sync !== "locked" && googleAccounts.length > 0;
  const [calendars, setCalendars] = useState<
    { id: string; name: string; primary?: boolean }[] | null
  >(null);
  const [calError, setCalError] = useState<string | null>(null);

  const connectionId =
    value.provider === "google" ? value.calendarConnectionId : null;
  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    fetch(
      `/api/booking-sync/google-calendars?connectionId=${encodeURIComponent(connectionId)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setCalendars([]);
          setCalError(d.error || "Could not load calendars.");
        } else {
          setCalendars(Array.isArray(d.calendars) ? d.calendars : []);
          setCalError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCalendars([]);
          setCalError("Could not load calendars.");
        }
      });
    return () => {
      cancelled = true;
      setCalendars(null);
    };
  }, [connectionId]);

  const set = (patch: Partial<SourceDraft>) => onChange({ ...value, ...patch });

  return (
    <section className="space-y-2 rounded-lg bg-muted/40 p-3">
      <div className="space-y-1">
        <Label htmlFor="bt-source">Where times come from</Label>
        <Select
          value={value.provider}
          onValueChange={(v) => {
            const provider = v as Provider;
            if (provider === "google")
              set({
                provider,
                calendarConnectionId:
                  value.calendarConnectionId ?? googleAccounts[0]?.id ?? null,
              });
            else set({ provider });
          }}
        >
          <SelectTrigger id="bt-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="native">Your weekly hours here</SelectItem>
            <SelectItem
              value="google"
              disabled={!googleAllowed && value.provider !== "google"}
            >
              Weekly hours, checked against Google Calendar
              {sync === "locked"
                ? " (Pro)"
                : !googleAllowed
                  ? " (connect Google first)"
                  : ""}
            </SelectItem>
            <SelectItem value="calendly">Your Calendly page</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.provider === "google" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="bt-gacct">Google account</Label>
            <Select
              value={value.calendarConnectionId ?? ""}
              onValueChange={(v) =>
                set({ calendarConnectionId: v, calendarId: null })
              }
            >
              <SelectTrigger id="bt-gacct">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {googleAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.email ?? a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bt-gcal">Calendar</Label>
            <Select
              value={value.calendarId ?? ""}
              onValueChange={(v) => set({ calendarId: v })}
              disabled={!calendars?.length && !value.calendarId}
            >
              <SelectTrigger id="bt-gcal">
                <SelectValue
                  placeholder={
                    calendars === null && connectionId
                      ? "Loading…"
                      : "Choose a calendar"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {value.calendarId &&
                  !calendars?.some((c) => c.id === value.calendarId) && (
                    <SelectItem value={value.calendarId}>
                      {value.calendarId}
                    </SelectItem>
                  )}
                {(calendars ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.primary ? " (main)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {calError && <p className="text-xs text-destructive">{calError}</p>}
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Times busy in Google aren&apos;t offered, and each booking is added
            to this calendar. Deleting the event in Google cancels the booking;
            moving it in Google doesn&apos;t move the booking.
          </p>
        </div>
      )}

      {value.provider === "calendly" && (
        <div className="space-y-1">
          <Label htmlFor="bt-calurl">Calendly link</Label>
          <Input
            id="bt-calurl"
            maxLength={500}
            placeholder="https://calendly.com/your-name/30min"
            value={value.calendlyUrl ?? ""}
            onChange={(e) => set({ calendlyUrl: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Visitors pick a time on your Calendly page, shown inside your
            booking page and offered by the chat widget. Hours, questions and
            reminders are managed in Calendly.
            {sync && sync !== "locked" && sync.calendly.webhook === "active"
              ? " Bookings made there appear in your list."
              : sync === "locked" ? " Seeing those bookings here needs the Pro plan." : " Connect Calendly above to see those bookings here."}
          </p>
        </div>
      )}
    </section>
  );
}
