"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarX, Clock, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BookingFlow } from "./booking-flow";

interface Data {
  booking: { name: string; startsAt: string; endsAt: string; status: string; visitorTimezone: string | null; canChange: boolean };
  type: { slug: string; name: string; durationMin: number; locationLabel: string; locationDetail: string | null } | null;
  business: { name: string; timezone: string; pk: string };
}

const STATUS_TEXT: Record<string, string> = {
  cancelled: "This booking is cancelled.",
  completed: "This meeting has taken place.",
  no_show: "This meeting has passed.",
};

export function ManageBooking({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"details" | "reschedule" | "cancel">("details");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/bookings/manage?token=${encodeURIComponent(token)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Booking not found.");
      setData(d);
    } catch (e: any) {
      setError(e.message || "Booking not found.");
    }
  }, [token]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function cancel() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await fetch("/api/public/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "cancel", reason: reason.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not cancel.");
      setView("details");
      await load();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
        <CalendarX className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm text-muted-foreground">{error} The link may be incomplete. Please use the link from your email.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  const tz = data.booking.visitorTimezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : data.business.timezone);
  const when = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(data.booking.startsAt));
  const typeName = data.type?.name ?? "Booking";

  return (
    <div className="rounded-2xl border bg-background p-6 sm:p-8 shadow-sm space-y-6 max-w-2xl mx-auto">
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">{data.business.name}</div>
        <h1 className="text-2xl font-bold tracking-tight">{typeName}</h1>
        <div className={`text-lg ${data.booking.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>{when}</div>
        <div className="text-xs text-muted-foreground">Shown in {tz}</div>
        {data.type && (
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden /> {data.type.durationMin} minutes
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden /> {data.type.locationLabel}
              {data.type.locationDetail ? `: ${data.type.locationDetail}` : ""}
            </span>
          </div>
        )}
        {STATUS_TEXT[data.booking.status] && (
          <p className="text-sm font-medium" role="status">
            {STATUS_TEXT[data.booking.status]}
          </p>
        )}
      </div>

      {data.booking.canChange && view === "details" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setView("reschedule")}>Reschedule</Button>
          <Button variant="outline" onClick={() => setView("cancel")}>
            Cancel booking
          </Button>
        </div>
      )}
      {data.booking.status === "confirmed" && !data.booking.canChange && (
        <p className="text-sm text-muted-foreground">This booking can&apos;t be changed online any more. Please contact {data.business.name} directly.</p>
      )}

      {view === "cancel" && (
        <div className="space-y-3 border-t pt-5">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea id="cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="destructive" onClick={cancel} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel booking
            </Button>
            <Button variant="ghost" onClick={() => setView("details")} disabled={busy}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {view === "reschedule" && data.type && (
        <div className="border-t pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Pick a new time</h2>
            <Button variant="ghost" size="sm" onClick={() => setView("details")}>
              Back
            </Button>
          </div>
          <BookingFlow
            pk={data.business.pk}
            businessName={data.business.name}
            type={{ slug: data.type.slug, name: data.type.name, description: null, durationMin: data.type.durationMin, locationLabel: data.type.locationLabel, questions: [] }}
            mode={{ kind: "reschedule", token, currentStart: data.booking.startsAt }}
            onRescheduled={() => {
              setTimeout(() => {
                setView("details");
                load();
              }, 2500);
            }}
          />
        </div>
      )}
    </div>
  );
}
