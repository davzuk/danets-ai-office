"use client";

// Content Studio → Analytics (Phase 1 M): engagement and leads per post,
// best posting times, follower growth and the weekly AI insight.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Lightbulb, Loader2, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, TrendingUp, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PLATFORM_RULES, type ContentGoal, type ContentPlatform } from "@/lib/content/platforms";
import type { AnalyticsReport, HeatCell, PostStat } from "@/lib/social/analytics";
import type { PublicInsight } from "@/lib/social/insights";
import { cn } from "@/lib/utils";
import { PlatformDot, api, errMsg } from "@/components/dashboard/views/content-shared";

export interface StudioIdea {
  brief: string;
  platforms: ContentPlatform[];
  goal: ContentGoal | null;
}

interface AnalyticsResponse {
  report: AnalyticsReport;
  insight: PublicInsight | null;
  canGenerateInsight: boolean;
}

const RANGES = [7, 28, 90] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS = ["00–03", "03–06", "06–09", "09–12", "12–15", "15–18", "18–21", "21–24"];
const TREND_METRICS = { engagements: "Engagements", impressions: "Views", leads: "Leads" } as const;
type TrendMetric = keyof typeof TREND_METRICS;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number | null | undefined) => (n == null ? "–" : compact.format(n));
const pct = (r: number | null | undefined) => (r == null ? "–" : `${(r * 100).toFixed(1)}%`);
const platformLabel = (p: string) => PLATFORM_RULES[p as ContentPlatform]?.label ?? p;
const ACCOUNT_LABEL: Record<string, string> = { facebook_page: "Facebook", instagram: "Instagram", linkedin_page: "LinkedIn" };

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
};

export function ContentAnalytics({ onOpenIdea }: { onOpenIdea: (idea: StudioIdea) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(28);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<AnalyticsResponse>(`/api/social-analytics?days=${days}`));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const r = await api<{ insight: PublicInsight }>("/api/social-analytics/insights", { method: "POST" });
      setData((d) => (d ? { ...d, insight: r.insight } : d));
      toast.success("Insight updated");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setGenerating(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { report, insight, canGenerateInsight } = data;
  const sum = (k: "posts" | "impressions" | "engagements" | "visits" | "leads") => report.totals.reduce((a, t) => a + t[k], 0);
  const rateBase = report.posts.reduce((a, p) => a + (p.metrics ? p.metrics.reach || p.metrics.impressions || 0 : 0), 0);
  const rateEng = report.posts.reduce((a, p) => a + (p.metrics && (p.metrics.reach || p.metrics.impressions) ? p.metrics.engagements ?? 0 : 0), 0);

  return (
    <div className="space-y-4">
      <InsightCard insight={insight} canGenerate={canGenerateInsight} generating={generating} onGenerate={generate} onOpenIdea={onOpenIdea} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Posts published through Danets in the last {report.range.days} days. Times in {report.range.timezone}.
        </p>
        <ToggleGroup type="single" size="sm" variant="outline" value={String(days)} onValueChange={(v) => v && setDays(Number(v) as typeof days)}>
          {RANGES.map((r) => (
            <ToggleGroupItem key={r} value={String(r)} className="px-3 text-xs">
              {r} days
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {report.posts.length === 0 ? (
        <Card className="p-8 text-center">
          <TrendingUp className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-2 font-semibold">Nothing published in this period</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Schedule posts to a connected Facebook, Instagram or LinkedIn Page. Their views, engagement and the leads they bring in show up here
            about an hour after they go out.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Posts" value={fmt(sum("posts"))} />
            <Stat label="Views" value={fmt(sum("impressions"))} />
            <Stat label="Engagements" value={fmt(sum("engagements"))} />
            <Stat label="Engagement rate" value={pct(rateBase ? rateEng / rateBase : null)} />
            <Stat label="Site visits" value={fmt(sum("visits"))} hint="Through tagged links" />
            <Stat label="Leads" value={fmt(sum("leads"))} hint="From those visits" strong />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <TrendChart report={report} />
            <PlatformTable report={report} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopPosts title="Top posts by engagement rate" posts={report.topByEngagement} by="engagement" />
            <TopPosts title="Top posts by leads" posts={report.topByLeads} by="leads" empty="No leads have come through post links yet. Add a link to your website on your next post." />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Heatmap cells={report.heatmap} />
            <Followers report={report} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", strong && "text-primary")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

// ─── Insight ───────────────────────────────────────────────────────────

function InsightCard({
  insight,
  canGenerate,
  generating,
  onGenerate,
  onOpenIdea,
}: {
  insight: PublicInsight | null;
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
  onOpenIdea: (idea: StudioIdea) => void;
}) {
  const button = canGenerate && (
    <Button size="sm" variant="outline" onClick={onGenerate} disabled={generating}>
      {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {insight ? "Refresh" : "Write it now"}
    </Button>
  );
  if (!insight) {
    return (
      <Card className="flex-row items-center gap-4 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Lightbulb className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Weekly insight</h2>
          <p className="text-sm text-muted-foreground">
            Every Monday the AI reviews the last four weeks of posts: what worked, what didn&apos;t, and three post ideas for the week. Uses one AI
            credit.
          </p>
        </div>
        {button}
      </Card>
    );
  }
  const c = insight.content;
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Lightbulb className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            Weekly insight · {new Date(insight.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
          <h2 className="font-semibold leading-snug">{c.headline}</h2>
        </div>
        {button}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <InsightList icon={<ThumbsUp className="size-3.5" />} title="What worked" items={c.worked} />
        <InsightList icon={<ThumbsDown className="size-3.5" />} title="What didn't" items={c.didnt} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">Ideas for this week</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {c.ideas.map((idea, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-1.5">
                {idea.platforms.map((p) => <PlatformDot key={p} platform={p} className="size-4 text-[8px]" />)}
              </div>
              <div className="text-sm font-medium">{idea.title}</div>
              <p className="line-clamp-4 flex-1 text-xs text-muted-foreground">{idea.brief}</p>
              <Button size="sm" variant="secondary" className="self-start" onClick={() => onOpenIdea({ brief: idea.brief, platforms: idea.platforms, goal: idea.goal })}>
                <Sparkles className="size-3.5" /> Open in Studio
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function InsightList({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        {icon} {title}
      </h3>
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Charts and tables ─────────────────────────────────────────────────

function TrendChart({ report }: { report: AnalyticsReport }) {
  const [metric, setMetric] = useState<TrendMetric>("engagements");
  const data = report.trend.map((d) => ({
    ...d,
    label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
  }));
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{TREND_METRICS[metric]} by publish day</h3>
        <ToggleGroup type="single" size="sm" variant="outline" value={metric} onValueChange={(v) => v && setMetric(v as TrendMetric)}>
          {Object.entries(TREND_METRICS).map(([k, l]) => (
            <ToggleGroupItem key={k} value={k} className="px-2 text-xs">
              {l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={12} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={36} tickFormatter={(v) => compact.format(v)} />
            <RechartsTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              contentStyle={tooltipStyle}
              formatter={(v: number, _n, item) => [`${Number(v).toLocaleString()} (${item.payload.posts} post${item.payload.posts === 1 ? "" : "s"})`, TREND_METRICS[metric]]}
            />
            <Bar dataKey={metric} fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PlatformTable({ report }: { report: AnalyticsReport }) {
  return (
    <Card className="gap-2 p-4">
      <h3 className="text-sm font-medium">By platform</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="py-1 font-normal">Platform</th>
            <th className="py-1 text-right font-normal">Posts</th>
            <th className="py-1 text-right font-normal">Views</th>
            <th className="py-1 text-right font-normal">Rate</th>
            <th className="py-1 text-right font-normal">Leads</th>
          </tr>
        </thead>
        <tbody>
          {report.totals.map((t) => (
            <tr key={t.platform} className="border-t">
              <td className="py-2">
                <span className="flex items-center gap-1.5">
                  <PlatformDot platform={t.platform} className="size-4 text-[8px]" /> {platformLabel(t.platform)}
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">{t.posts}</td>
              <td className="py-2 text-right tabular-nums">{fmt(t.impressions)}</td>
              <td className="py-2 text-right tabular-nums">{pct(t.engagementRate)}</td>
              <td className="py-2 text-right font-medium tabular-nums">{t.leads}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground">Rate is engagements ÷ reach. Posts you marked as posted by hand have no metrics.</p>
    </Card>
  );
}

function TopPosts({ title, posts, by, empty }: { title: string; posts: PostStat[]; by: "engagement" | "leads"; empty?: string }) {
  return (
    <Card className="gap-2 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {posts.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{empty ?? "No metrics yet. They arrive about an hour after a post goes out."}</p>
      ) : (
        <ol className="divide-y">
          {posts.map((p) => (
            <li key={p.id} className="flex items-start gap-3 py-2.5">
              <PlatformDot platform={p.platform} className="mt-0.5 size-5 shrink-0 text-[9px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{p.excerpt}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(p.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {p.accountName ? ` · ${p.accountName}` : ""} · {fmt(p.metrics?.impressions)} views · {fmt(p.visits)} visits
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{by === "leads" ? p.leads : pct(p.engagementRate)}</div>
                <div className="text-[11px] text-muted-foreground">{by === "leads" ? (p.leads === 1 ? "lead" : "leads") : "rate"}</div>
                {p.permalink && (
                  <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline">
                    View <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Weekday × 3-hour grid of average engagement rate: one hue, darker = higher. */
function Heatmap({ cells }: { cells: HeatCell[] }) {
  const max = Math.max(0, ...cells.map((c) => c.avgRate));
  const at = new Map(cells.map((c) => [`${c.weekday}:${c.block}`, c]));
  const best = cells.length ? cells.reduce((a, b) => (b.avgRate > a.avgRate ? b : a)) : null;
  return (
    <Card className="gap-3 p-4">
      <div>
        <h3 className="text-sm font-medium">Best times to post</h3>
        <p className="text-xs text-muted-foreground">
          {best
            ? `Your posts do best on ${WEEKDAYS[best.weekday]} ${BLOCKS[best.block]} (${pct(best.avgRate)} average engagement rate).`
            : "Shows up once posts have metrics."}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-[2px] text-[11px]">
          <thead>
            <tr>
              <th />
              {BLOCKS.map((b) => (
                <th key={b} className="pb-1 font-normal text-muted-foreground">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((d, w) => (
              <tr key={d}>
                <th className="pr-2 text-left font-normal text-muted-foreground">{d}</th>
                {BLOCKS.map((b, i) => {
                  const c = at.get(`${w}:${i}`);
                  const level = c && max > 0 ? 0.2 + 0.8 * (c.avgRate / max) : 0;
                  const label = c ? `${d} ${b}: ${pct(c.avgRate)} average rate, ${c.posts} post${c.posts === 1 ? "" : "s"}` : `${d} ${b}: no posts`;
                  return (
                    <td
                      key={b}
                      title={label}
                      aria-label={label}
                      className="h-7 rounded-[4px]"
                      style={{
                        background: c ? `color-mix(in oklab, var(--primary) ${Math.round(level * 100)}%, var(--card))` : "var(--muted)",
                      }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Lower</span>
        <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--primary) 20%, var(--card)), var(--primary))" }} />
        <span>Higher engagement rate</span>
      </div>
    </Card>
  );
}

function Followers({ report }: { report: AnalyticsReport }) {
  return (
    <Card className="gap-2 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Users className="size-4" /> Followers
      </h3>
      {report.followers.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Follower counts are recorded once a day for each connected Page.</p>
      ) : (
        <ul className="divide-y">
          {report.followers.map((f) => {
            const latest = f.points[f.points.length - 1]?.followers ?? null;
            return (
              <li key={f.socialAccountId} className="flex items-center gap-3 py-2.5">
                <PlatformDot platform={ACCOUNT_LABEL[f.platform]?.toLowerCase() ?? f.platform} className="size-5 shrink-0 text-[9px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground">{ACCOUNT_LABEL[f.platform] ?? f.platform}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmt(latest)}</div>
                  <div
                    className={cn(
                      "text-[11px] tabular-nums",
                      f.growth == null ? "text-muted-foreground" : f.growth >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    )}
                  >
                    {f.growth == null ? "first count" : `${f.growth >= 0 ? "+" : ""}${f.growth.toLocaleString()} in ${report.range.days}d`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
