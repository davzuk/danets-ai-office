"use client";

import { useEffect, useState } from "react";
import { Route, Flag, MousePointerClick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { leadSourceColor, leadSourceLabel, TOUCH_KIND_LABEL } from "@/lib/channel-meta";

interface Touch {
  id: string;
  kind: string;
  channel: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  clickIdType: string | null;
  landingUrl: string | null;
  referrer: string | null;
  occurredAt: string;
}

interface Journey {
  firstTouchId: string | null;
  lastTouchId: string | null;
  contact: {
    firstSeenAt: string;
    counts: { leads: number; chatSessions: number; supportTickets: number; quoteRequests: number };
  } | null;
  touchpoints: Touch[];
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Journey" tab on lead detail: every touchpoint for the lead's contact, oldest first. */
export function LeadJourney({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Journey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leads/${leadId}/journey`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load journey");
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load journey");
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-32 w-full" />;
  if (data.touchpoints.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Route className="mx-auto mb-2 size-5" />
        No journey recorded. Leads captured before attribution tracking, or added manually, have no touchpoints.
      </div>
    );
  }

  const c = data.contact;
  return (
    <div className="space-y-4">
      {c && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          First seen {new Date(c.firstSeenAt).toLocaleDateString()} · {plural(data.touchpoints.length, "touchpoint")} ·{" "}
          {plural(c.counts.chatSessions, "chat")} · {plural(c.counts.leads, "lead")}
          {c.counts.supportTickets > 0 && <> · {plural(c.counts.supportTickets, "ticket")}</>}
          {c.counts.quoteRequests > 0 && <> · {plural(c.counts.quoteRequests, "quote")}</>}
        </div>
      )}
      <ol className="relative space-y-4 border-l pl-5">
        {data.touchpoints.map((t) => {
          const details = [
            t.source && `source: ${t.source}`,
            t.medium && `medium: ${t.medium}`,
            t.campaign && `campaign: ${t.campaign}`,
            t.term && `term: ${t.term}`,
            t.content && `content: ${t.content}`,
          ].filter(Boolean);
          return (
            <li key={t.id} className="relative">
              <span
                className="absolute -left-[26px] top-1 size-3 rounded-full ring-4 ring-background"
                style={{ background: leadSourceColor(t.channel) }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{TOUCH_KIND_LABEL[t.kind] ?? t.kind}</span>
                <Badge variant="secondary" className="text-xs">
                  {leadSourceLabel(t.channel)}
                </Badge>
                {t.id === data.firstTouchId && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Flag className="size-3" /> First touch
                  </Badge>
                )}
                {t.clickIdType && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <MousePointerClick className="size-3" /> {t.clickIdType}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{new Date(t.occurredAt).toLocaleString()}</div>
              {details.length > 0 && <div className="mt-1 text-xs text-muted-foreground">{details.join(" · ")}</div>}
              {(t.landingUrl || t.referrer) && (
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground break-all">
                  {t.landingUrl && <div>Landed on {t.landingUrl}</div>}
                  {t.referrer && <div>From {t.referrer}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
