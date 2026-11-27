"use client";

// SEO (Phase 3, workstream V). The Performance dashboard: search clicks,
// impressions, CTR and position over time (with previous-period comparison),
// top queries and pages (with organic leads per page) and device/country
// breakdowns. Everything is read from SearchMetricDaily via
// /api/seo/performance, so rendering never waits on Google.

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Globe, Loader2, MousePointerClick, Search, Smartphone, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BLUE = "#1d4ed8";
const GREEN = "#84cc16";

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SeriesPoint extends Totals {
  date: string;
}

interface QueryRow extends Totals {
  key: string;
  previousClicks: number;
  previousImpressions: number;
  changeImpressions: number;
}

interface PageRow extends Totals {
  key: string;
  leads: number;
}

interface BreakdownRow extends Totals {
  key: string;
}

interface PerformanceData {
  propertyId: string | null;
  properties: { id: string; siteUrl: string; syncedThrough: string | null; lastSyncedAt: string | null }[];
  range: { from: string; to: string; days: number };
  totals: Totals;
  previous: Totals;
  series: SeriesPoint[];
  queries: QueryRow[];
  pages: PageRow[];
  devices: BreakdownRow[];
  countries: BreakdownRow[];
}

const RANGES = [7, 28, 90] as const;

const num = (n: number) => n.toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos = (n: number) => (n ? n.toFixed(1) : "—");

function Delta({ value, label, invert = false }: { value: number; label: string; invert?: boolean }) {
  const up = invert ? value < 0 : value > 0;
  const flat = value === 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs", flat ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      {flat ? null : up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {label}
    </span>
  );
}

const shortLabel = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)}/${m}`;
};

export function SeoPerformanceView() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<number>(28);
  const [propertyId, setPropertyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ range: String(range) });
      if (propertyId) q.set("property", propertyId);
      setData(await api<PerformanceData>(`/api/seo/performance?${q}`));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [range, propertyId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  const hasProperty = !!data.properties.length;
  const synced = data.properties.find((p) => p.id === data.propertyId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Search performance</h1>
          <p className="text-sm text-muted-foreground">
            Clicks, impressions and position from Google Search Console.
            {synced?.syncedThrough ? ` Synced through ${synced.syncedThrough}.` : " Waiting for the first sync."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.properties.length > 1 && (
            <select
              value={data.propertyId ?? ""}
              onChange={(e) => setPropertyId(e.target.value || null)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              aria-label="Property"
            >
              {data.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.siteUrl.replace(/^sc-domain:/, "")}
                </option>
              ))}
            </select>
          )}
          <div className="inline-flex items-center rounded-lg border p-0.5">
            {RANGES.map((r) => (
              <Button key={r} size="sm" variant={range === r ? "secondary" : "ghost"} className="h-8" onClick={() => setRange(r)}>
                {r}d
              </Button>
            ))}
          </div>
        </div>
      </div>

      {!hasProperty ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Add a Search Console property on the Setup tab to see how people find you on Google.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Clicks" value={num(data.totals.clicks)} icon={<MousePointerClick className="h-4 w-4" />} delta={<Delta value={data.totals.clicks - data.previous.clicks} label={diffLabel(data.totals.clicks, data.previous.clicks)} />} />
            <MetricCard title="Impressions" value={num(data.totals.impressions)} icon={<Search className="h-4 w-4" />} delta={<Delta value={data.totals.impressions - data.previous.impressions} label={diffLabel(data.totals.impressions, data.previous.impressions)} />} />
            <MetricCard title="CTR" value={pct(data.totals.ctr)} icon={<TrendingUp className="h-4 w-4" />} delta={<Delta value={data.totals.ctr - data.previous.ctr} label={ppDiff(data.totals.ctr, data.previous.ctr)} />} />
            <MetricCard title="Avg position" value={pos(data.totals.position)} icon={<Globe className="h-4 w-4" />} delta={<Delta value={(data.totals.position - data.previous.position) * -1} label={pos(data.totals.position - data.previous.position)} />} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clicks and impressions</CardTitle>
              <CardDescription>{data.range.from} to {data.range.to}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="spClicks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BLUE} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="spImpressions" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={GREEN} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="date" tickFormatter={shortLabel} tickLine={false} axisLine={false} fontSize={12} minTickGap={24} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={44} />
                    <RechartsTooltip
                      contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 12 }}
                      formatter={(value: number, name: string) => [num(Number(value)), name]}
                    />
                    <Area type="monotone" dataKey="impressions" name="Impressions" stroke={GREEN} strokeWidth={2} fill="url(#spImpressions)" activeDot={{ r: 4 }} />
                    <Area type="monotone" dataKey="clicks" name="Clicks" stroke={BLUE} strokeWidth={2} fill="url(#spClicks)" activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top queries</CardTitle>
                <CardDescription>By impressions · movement vs the previous period. {(data.totals.ctr * 100).toFixed(1)}% of impressions became clicks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.queries.length === 0 ? (
                  <Empty />
                ) : (
                  data.queries.map((q) => (
                    <div key={q.key} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1 truncate" title={q.key}>{q.key}</div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span title="Impressions">{num(q.impressions)} imp</span>
                        <span title="Clicks">{num(q.clicks)} clk</span>
                        <span title="Average position">#{pos(q.position)}</span>
                        <Mover change={q.changeImpressions} />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top pages</CardTitle>
                <CardDescription>By impressions · with leads that came from organic search.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.pages.length === 0 ? (
                  <Empty />
                ) : (
                  data.pages.map((p) => (
                    <div key={p.key} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1 truncate text-xs" title={p.key}>{p.key}</div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span title="Impressions">{num(p.impressions)} imp</span>
                        <span title="Clicks">{num(p.clicks)} clk</span>
                        <Badge variant="outline" className="px-1.5 py-0">{p.leads} leads</Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" /> Devices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.devices.map((d) => (
                  <div key={d.key}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="capitalize">{deviceLabel(d.key)}</span>
                      <span className="text-xs text-muted-foreground">{pct(d.ctr)} CTR · {num(d.clicks)} clicks</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full" style={{ width: sharePct(d.impressions, data.devices), backgroundColor: BLUE }} />
                    </div>
                  </div>
                ))}
                {data.devices.length === 0 && <Empty />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Globe className="h-4 w-4" /> Countries</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.countries.map((c) => (
                  <div key={c.key} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm">
                    <span>{c.key}</span>
                    <span className="text-xs text-muted-foreground">{num(c.impressions)} imp · {num(c.clicks)} clk</span>
                  </div>
                ))}
                {data.countries.length === 0 && <Empty />}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ title, value, icon, delta }: { title: string; value: string; icon: React.ReactNode; delta: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon} {title}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1">{delta}</div>
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="px-2 py-4 text-sm text-muted-foreground">No data in this period yet.</p>;
}

function Mover({ change }: { change: number }) {
  const flat = change === 0;
  const up = change > 0;
  return (
    <span className={cn("inline-flex w-16 items-center justify-end gap-0.5 tabular-nums", flat ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} title="Change in impressions">
      {flat ? null : up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {flat ? "—" : num(Math.abs(change))}
    </span>
  );
}

function diffLabel(cur: number, prev: number) {
  if (prev === 0) return cur > 0 ? "new" : "—";
  return `${Math.round(((cur - prev) / prev) * 100)}%`;
}

function ppDiff(cur: number, prev: number) {
  return `${(cur - prev >= 0 ? "+" : "") + ((cur - prev) * 100).toFixed(1)}pp`;
}

function sharePct(value: number, all: BreakdownRow[]) {
  const total = all.reduce((s, d) => s + d.impressions, 0);
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
}

function deviceLabel(key: string) {
  const map: Record<string, string> = { DESKTOP: "Desktop", MOBILE: "Mobile", TABLET: "Tablet" };
  return map[key] ?? key;
}