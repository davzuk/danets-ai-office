"use client";

// Leads → Bookings (Phase 2, workstream P): upcoming and past bookings, a
// month calendar, and the booking types editor. Times show in the business
// timezone.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, List, Loader2, Mail, Phone, Settings2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { zonedDateKey } from "@/lib/content/timezone";
import { addDaysKey } from "@/lib/booking/slots";
import { BookingTypesPanel } from "./booking-types-panel";

export interface BookingRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  source: string;
  notes: string | null;
  answers: Record<string, string> | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  bookingType: { id: string; name: string; durationMin: number; location: string; questions: { key: string; label: string }[] | null } | null;
  lead: { id: string; name: string; status: string } | null;
}

const STATUS: Record<BookingRow["status"], { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-transparent" },
  completed: { label: "Completed", className: "bg-primary/10 text-primary border-transparent" },
  no_show: { label: "No-show", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-transparent" },
};

const SOURCE_LABEL: Record<string, string> = { page: "Booking page", widget: "Chat widget", dashboard: "Dashboard" };

const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: tz, ...o }).format(new Date(iso));
const timeRange = (b: BookingRow, tz: string) => `${fmt(b.startsAt, tz, { hour: "numeric", minute: "2-digit" })}–${fmt(b.endsAt, tz, { hour: "numeric", minute: "2-digit" })}`;
const dayLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
};

function useBookings(query: string) {
  const [data, setData] = useState<{ bookings: BookingRow[]; timezone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/bookings?${query}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load bookings.");
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [query]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  return { data, error, reload: load };
}

export function BookingsPanel({ onOpenLead }: { onOpenLead: (lead: { id: string; name: string }) => void }) {
  const [tab, setTab] = useState("upcoming");
  const [selected, setSelected] = useState<{ booking: BookingRow; tz: string } | null>(null);
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" /> Bookings
        </CardTitle>
        <CardDescription>Meetings visitors booked from your booking page or the chat widget.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="upcoming">
              <List className="h-4 w-4" /> Upcoming
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays className="h-4 w-4" /> Calendar
            </TabsTrigger>
            <TabsTrigger value="past">
              <Clock className="h-4 w-4" /> Past
            </TabsTrigger>
            <TabsTrigger value="types">
              <Settings2 className="h-4 w-4" /> Booking types
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4">
            <BookingList key={`u${version}`} kind="upcoming" onSelect={(booking, tz) => setSelected({ booking, tz })} onShowTypes={() => setTab("types")} />
          </TabsContent>
          <TabsContent value="past" className="mt-4">
            <BookingList key={`p${version}`} kind="past" onSelect={(booking, tz) => setSelected({ booking, tz })} onShowTypes={() => setTab("types")} />
          </TabsContent>
          <TabsContent value="calendar" className="mt-4">
            <BookingCalendar key={`c${version}`} onSelect={(booking, tz) => setSelected({ booking, tz })} />
          </TabsContent>
          <TabsContent value="types" className="mt-4">
            <BookingTypesPanel />
          </TabsContent>
        </Tabs>
      </CardContent>
      <BookingDialog
        selected={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          changed();
        }}
        onOpenLead={onOpenLead}
      />
    </Card>
  );
}

function BookingList({ kind, onSelect, onShowTypes }: { kind: "upcoming" | "past"; onSelect: (b: BookingRow, tz: string) => void; onShowTypes: () => void }) {
  const query = useMemo(() => {
    const now = new Date();
    return kind === "upcoming"
      ? new URLSearchParams({ from: now.toISOString(), to: new Date(now.getTime() + 90 * 86_400_000).toISOString(), status: "confirmed" }).toString()
      : new URLSearchParams({ from: new Date(now.getTime() - 90 * 86_400_000).toISOString(), to: now.toISOString(), order: "desc" }).toString();
  }, [kind]);
  const { data, error } = useBookings(query);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data)
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  if (data.bookings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground space-y-2">
        <p>{kind === "upcoming" ? "No upcoming bookings in the next 90 days." : "No bookings in the last 90 days."}</p>
        {kind === "upcoming" && (
          <Button variant="outline" size="sm" onClick={onShowTypes}>
            Set up booking types
          </Button>
        )}
      </div>
    );
  }

  const tz = data.timezone;
  const groups = new Map<string, BookingRow[]>();
  for (const b of data.bookings) {
    const key = zonedDateKey(new Date(b.startsAt), tz);
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(key)}</h3>
          {list.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect(b, tz)}
              className="w-full text-left rounded-lg border p-3 hover:border-primary/60 hover:bg-muted/40 transition-colors flex flex-wrap items-center gap-x-4 gap-y-1"
            >
              <span className="text-sm font-semibold tabular-nums w-32 shrink-0">{timeRange(b, tz)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium">{b.name}</span>
                <span className="text-xs text-muted-foreground"> · {b.bookingType?.name ?? "Booking"}</span>
              </span>
              <Badge variant="outline" className={STATUS[b.status].className}>
                {STATUS[b.status].label}
              </Badge>
            </button>
          ))}
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Times in {tz}.</p>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function BookingCalendar({ onSelect }: { onSelect: (b: BookingRow, tz: string) => void }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const grid = useMemo(() => {
    const first = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const mondayOffset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const start = addDaysKey(first, -mondayOffset);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const days: string[] = [];
    for (let k = start; k < nextMonth || days.length % 7 !== 0; k = addDaysKey(k, 1)) days.push(k);
    return days;
  }, [month]);
  const query = useMemo(() => {
    // A day either side covers any timezone offset.
    const from = new Date(`${addDaysKey(grid[0], -1)}T00:00:00Z`);
    const to = new Date(`${addDaysKey(grid[grid.length - 1], 2)}T00:00:00Z`);
    return new URLSearchParams({ from: from.toISOString(), to: to.toISOString() }).toString();
  }, [grid]);
  const { data, error } = useBookings(query);
  const tz = data?.timezone ?? "UTC";
  const byDay = useMemo(() => {
    const map = new Map<string, BookingRow[]>();
    for (const b of data?.bookings ?? []) {
      const key = zonedDateKey(new Date(b.startsAt), tz);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [data, tz]);
  const todayKey = zonedDateKey(new Date(), tz);
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const [y, m] = month.split("-").map(Number);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="font-medium" aria-live="polite">
          {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)))}
        </div>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-px rounded-lg border bg-border min-w-[560px]">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-muted/60 px-2 py-1 text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
          {grid.map((key) => {
            const list = byDay.get(key) ?? [];
            const inMonth = key.startsWith(month);
            return (
              <div key={key} className={`bg-background min-h-[84px] p-1.5 space-y-1 ${inMonth ? "" : "opacity-50"}`}>
                <div className={`text-xs ${key === todayKey ? "font-bold text-primary" : "text-muted-foreground"}`}>{Number(key.slice(8))}</div>
                {list.slice(0, 3).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onSelect(b, tz)}
                    className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${STATUS[b.status].className} ${b.status === "cancelled" ? "line-through" : ""}`}
                    title={`${timeRange(b, tz)} ${b.name}`}
                  >
                    {fmt(b.startsAt, tz, { hour: "numeric", minute: "2-digit" })} {b.name}
                  </button>
                ))}
                {list.length > 3 && <div className="text-[11px] text-muted-foreground">+{list.length - 3} more</div>}
              </div>
            );
          })}
        </div>
      </div>
      {!data && !error && (
        <div className="flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      )}
      <p className="text-xs text-muted-foreground">Times in {tz}.</p>
    </div>
  );
}

function BookingDialog({
  selected,
  onClose,
  onChanged,
  onOpenLead,
}: {
  selected: { booking: BookingRow; tz: string } | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenLead: (lead: { id: string; name: string }) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const b = selected?.booking;
  const tz = selected?.tz ?? "UTC";
  const started = b ? new Date(b.startsAt).getTime() <= Date.now() : false;

  async function act(action: "cancel" | "complete" | "no_show") {
    if (!b) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "cancel" ? { action, reason: reason.trim() || undefined } : { action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not update the booking.");
      toast.success(action === "cancel" ? "Booking cancelled. The visitor has been emailed." : action === "complete" ? "Marked as completed." : "Marked as a no-show.");
      setCancelling(false);
      setReason("");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!selected}
      onOpenChange={(o) => {
        if (!o) {
          setCancelling(false);
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {b && (
          <>
            <DialogHeader>
              <DialogTitle>{b.bookingType?.name ?? "Booking"}</DialogTitle>
              <DialogDescription>
                {fmt(b.startsAt, tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, {timeRange(b, tz)} ({tz})
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STATUS[b.status].className}>
                  {STATUS[b.status].label}
                </Badge>
                <span className="text-xs text-muted-foreground">via {SOURCE_LABEL[b.source] ?? b.source}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-muted-foreground" /> {b.name}
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a className="text-primary hover:underline" href={`mailto:${b.email}`}>
                  {b.email}
                </a>
              </div>
              {b.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" /> {b.phone}
                </div>
              )}
              {b.answers &&
                Object.entries(b.answers).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-muted-foreground">{b.bookingType?.questions?.find((q) => q.key === k)?.label ?? k.replace(/_/g, " ")}: </span>
                    {v}
                  </div>
                ))}
              {b.notes && <p className="rounded-md bg-muted/60 p-2 whitespace-pre-line">{b.notes}</p>}
              {b.status === "cancelled" && (
                <p className="text-muted-foreground">
                  Cancelled by {b.cancelledBy === "visitor" ? "the visitor" : "your team"}
                  {b.cancelReason ? `: ${b.cancelReason}` : "."}
                </p>
              )}
            </div>
            {cancelling && (
              <div className="space-y-2">
                <Label htmlFor="bk-cancel-reason">Reason (included in the email to {b.name.split(" ")[0]})</Label>
                <Textarea id="bk-cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              {b.lead ? (
                <Button variant="ghost" size="sm" onClick={() => onOpenLead(b.lead!)}>
                  <ExternalLink className="h-4 w-4" /> Open lead
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap gap-2">
                {b.status === "confirmed" && started && (
                  <>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => act("no_show")}>
                      No-show
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => act("complete")}>
                      Completed
                    </Button>
                  </>
                )}
                {b.status === "confirmed" && !started && (
                  cancelling ? (
                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => act("cancel")}>
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Cancel and email {b.name.split(" ")[0]}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>
                      Cancel booking
                    </Button>
                  )
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

