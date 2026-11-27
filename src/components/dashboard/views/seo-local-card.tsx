"use client";

// SEO (Phase 3, workstream X). Business Profile performance next to Search
// Console's numbers: views on Search and Maps, and the calls, website clicks,
// direction requests and messages they led to.

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Globe2, Loader2, MapPin, MessageCircle, Navigation, Phone, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Group = "searchViews" | "mapsViews" | "calls" | "websiteClicks" | "directions" | "messages";
type Totals = Record<Group, number>;

interface LocalData {
  locations: { id: string; title: string; status: string; metricsSyncedThrough: string | null; metricsError: string | null }[];
  rangeDays: number;
  from: string | null;
  to: string | null;
  totals: Totals | null;
  previous: Totals | null;
  series: { date: string; views: number; actions: number }[];
  byLocation: { id: string; title: string; totals: Totals }[];
  hasData?: boolean;
}

const VIEWS = "#4285F4";
const ACTIONS = "#34A853";

const TILES: { key: Group; label: string; icon: typeof Search }[] = [
  { key: "searchViews", label: "Views on Search", icon: Search },
  { key: "mapsViews", label: "Views on Maps", icon: MapPin },
  { key: "calls", label: "Calls", icon: Phone },
  { key: "websiteClicks", label: "Website clicks", icon: Globe2 },
  { key: "directions", label: "Directions", icon: Navigation },
  { key: "messages", label: "Messages", icon: MessageCircle },
];

const num = (n: number) => n.toLocaleString();
const shortLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

function change(cur: number, prev: number) {
  if (prev === 0) return cur > 0 ? { label: "new", up: true } : null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return p === 0 ? null : { label: `${Math.abs(p)}%`, up: p > 0 };
}

export function LocalPerformanceCard({ range }: { range: number }) {
  const [data, setData] = useState<LocalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/seo/local?days=${range}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Couldn't load Business Profile performance.");
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [range]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (!data.locations.length) return null;

  const problem = data.locations.find((l) => l.metricsError);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4" /> Google Business Profile
        </CardTitle>
        <CardDescription>
          How often your profile showed on Google Search and Maps, and what people did next.
          {data.from && data.to && data.hasData ? ` ${shortLabel(data.from)} to ${shortLabel(data.to)}.` : " Waiting for the first sync (Google reports these a few days late)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {problem && (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {problem.title}: {problem.metricsError}
          </p>
        )}
        {data.totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {TILES.map((t) => {
              const c = data.previous ? change(data.totals![t.key], data.previous[t.key]) : null;
              return (
                <div key={t.key} className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <t.icon className="h-3.5 w-3.5" /> {t.label}
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums">{num(data.totals![t.key])}</div>
                  {c && (
                    <div className={cn("mt-0.5 inline-flex items-center gap-0.5 text-xs", c.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                      {c.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {c.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {data.hasData && (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gbpViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={VIEWS} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={VIEWS} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gbpActions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={ACTIONS} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={ACTIONS} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" tickFormatter={shortLabel} tickLine={false} axisLine={false} fontSize={12} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={44} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 12 }}
                  labelFormatter={(l) => shortLabel(String(l))}
                  formatter={(value: number, name: string) => [num(Number(value)), name]}
                />
                <Area type="monotone" dataKey="views" name="Profile views" stroke={VIEWS} strokeWidth={2} fill="url(#gbpViews)" activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="actions" name="Calls, clicks, directions and messages" stroke={ACTIONS} strokeWidth={2} fill="url(#gbpActions)" activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {data.byLocation.length > 1 && data.hasData && (
          <div className="space-y-1">
            {data.byLocation.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm odd:bg-muted/40">
                <span className="truncate">{l.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {num(l.totals.searchViews + l.totals.mapsViews)} views · {num(l.totals.calls)} calls · {num(l.totals.websiteClicks)} clicks · {num(l.totals.directions)} directions
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
