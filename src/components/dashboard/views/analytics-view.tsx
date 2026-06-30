"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  CalendarDays,
  DollarSign,
  Download,
  MessagesSquare,
  RefreshCw,
  Ticket as TicketIcon,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────

interface AnalyticsUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface ReportSummary {
  totalChats: number;
  totalLeads: number;
  totalTickets: number;
  totalProposals: number;
  aiRequests: number;
  aiTokens: number;
  aiCostUsd: number;
  conversionRate: number;
}

interface SourceItem {
  source: string;
  count: number;
}
interface StatusItem {
  status: string;
  count: number;
}
interface FeatureItem {
  feature: string;
  count: number;
  tokens: number;
}
interface TrendItem {
  month: string;
  chats: number;
  leads: number;
}

interface Report {
  period: { from: string; to: string };
  summary: ReportSummary;
  leadsBySource: SourceItem[];
  leadsByStatus: StatusItem[];
  ticketsByStatus: StatusItem[];
  aiByFeature: FeatureItem[];
  monthlyTrend: TrendItem[];
}

// ─── Date helpers ─────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayStr(): string {
  return toISODate(new Date());
}
function firstOfMonthStr(): string {
  const d = new Date();
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}
function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISODate(d);
}
function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
function formatCost(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function prettify(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Color palettes ───────────────────────────────────────────────────

const BRAND_BLUE = "#1d4ed8";
const BRAND_GREEN = "#84cc16";

const SOURCE_COLORS: Record<string, string> = {
  chatbot: BRAND_BLUE,
  website: "#0ea5e9",
  manual: "#f59e0b",
  whatsapp: BRAND_GREEN,
  referral: "#8b5cf6",
  email: "#06b6d4",
  phone: "#ec4899",
  other: "#64748b",
};

const STATUS_COLORS: Record<string, string> = {
  new: BRAND_BLUE,
  contacted: "#06b6d4",
  qualified: "#6366f1",
  proposal_sent: "#f59e0b",
  negotiation: "#8b5cf6",
  won: "#10b981",
  lost: "#ef4444",
};

const TICKET_BADGE: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  pending:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  in_progress:
    "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  resolved:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  closed:
    "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

const FEATURE_COLORS: Record<string, string> = {
  chat: BRAND_BLUE,
  suggested_reply: BRAND_GREEN,
  quote: "#0ea5e9",
  summary: "#f59e0b",
};

function sourceColor(s: string): string {
  return SOURCE_COLORS[s] || "#64748b";
}
function statusColor(s: string): string {
  return STATUS_COLORS[s] || "#64748b";
}
function featureColor(s: string): string {
  return FEATURE_COLORS[s] || "#64748b";
}
function ticketBadgeClass(s: string): string {
  return (
    TICKET_BADGE[s] || "bg-muted text-muted-foreground border-border"
  );
}

// ─── Main component ───────────────────────────────────────────────────

export function AnalyticsView({ user: _user }: { user: AnalyticsUser }) {
  const [from, setFrom] = React.useState<string>(firstOfMonthStr());
  const [to, setTo] = React.useState<string>(todayStr());
  const [appliedFrom, setAppliedFrom] = React.useState<string>(from);
  const [appliedTo, setAppliedTo] = React.useState<string>(to);

  const [report, setReport] = React.useState<Report | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/analytics/report?from=${encodeURIComponent(
        f
      )}&to=${encodeURIComponent(t)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Unauthorized. Please sign in again.");
        } else {
          setError(`Failed to load report (${res.status})`);
        }
        return;
      }
      const json = (await res.json()) as Report;
      setReport(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load(appliedFrom, appliedTo);
  }, [appliedFrom, appliedTo, load]);

  function applyFilters() {
    if (!from || !to) {
      toast.error("Please select both dates");
      return;
    }
    if (from > to) {
      toast.error("From date must be before To date");
      return;
    }
    setAppliedFrom(from);
    setAppliedTo(to);
    toast.success("Report updated", {
      description: `${from} → ${to}`,
    });
  }

  function applyQuickRange(range: "month" | "30" | "90") {
    const t = todayStr();
    let f: string;
    if (range === "month") f = firstOfMonthStr();
    else if (range === "30") f = daysAgoStr(30);
    else f = daysAgoStr(90);
    setFrom(f);
    setTo(t);
    setAppliedFrom(f);
    setAppliedTo(t);
    toast.success("Range applied", {
      description: `${f} → ${t}`,
    });
  }

  function exportCsv() {
    const url = `/api/analytics/report?from=${encodeURIComponent(
      appliedFrom
    )}&to=${encodeURIComponent(appliedTo)}&format=csv`;
    window.open(url, "_blank");
    toast.success("CSV export started", {
      description: `${appliedFrom} → ${appliedTo}`,
    });
  }

  const summary = report?.summary;
  const trend = report?.monthlyTrend ?? [];
  const sources = report?.leadsBySource ?? [];
  const leadStatuses = report?.leadsByStatus ?? [];
  const ticketStatuses = report?.ticketsByStatus ?? [];
  const features = report?.aiByFeature ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Analytics &amp; Reporting
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Comprehensive business insights and performance metrics.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(appliedFrom, appliedTo)}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw
            className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
          />
          Refresh
        </Button>
      </div>

      {/* Date Filter Toolbar */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> From
                </label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-[170px]"
                  max={to || undefined}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> To
                </label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-[170px]"
                  min={from || undefined}
                />
              </div>
              <Button
                onClick={applyFilters}
                disabled={loading}
                className="gap-2"
              >
                <RefreshCw
                  className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                />
                Apply
              </Button>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickRange("month")}
                  disabled={loading}
                >
                  This Month
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickRange("30")}
                  disabled={loading}
                >
                  Last 30 Days
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickRange("90")}
                  disabled={loading}
                >
                  Last 90 Days
                </Button>
              </div>
            </div>
            <Button
              onClick={exportCsv}
              variant="default"
              className="gap-2 shrink-0"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>

          <Separator />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Showing data for{" "}
              <strong className="text-foreground tabular-nums">
                {appliedFrom}
              </strong>{" "}
              →{" "}
              <strong className="text-foreground tabular-nums">
                {appliedTo}
              </strong>
            </span>
            {summary ? (
              <span className="tabular-nums">
                {formatNumber(summary.totalChats)} chats ·{" "}
                {formatNumber(summary.totalLeads)} leads ·{" "}
                {formatNumber(summary.totalTickets)} tickets
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      ) : null}

      {/* Summary Stat Cards */}
      {loading && !report ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-2">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <SummaryCard
            icon={MessagesSquare}
            label="Total Chats"
            value={formatNumber(summary?.totalChats ?? 0)}
            tint="bg-primary/10 text-primary"
          />
          <SummaryCard
            icon={Users}
            label="Total Leads"
            value={formatNumber(summary?.totalLeads ?? 0)}
            tint="bg-accent/30 text-accent-foreground"
          />
          <SummaryCard
            icon={TrendingUp}
            label="Conversion Rate"
            value={`${summary?.conversionRate ?? 0}%`}
            tint="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          />
          <SummaryCard
            icon={TicketIcon}
            label="Total Tickets"
            value={formatNumber(summary?.totalTickets ?? 0)}
            tint="bg-rose-500/15 text-rose-600 dark:text-rose-400"
          />
          <SummaryCard
            icon={Zap}
            label="AI Requests"
            value={formatNumber(summary?.aiRequests ?? 0)}
            tint="bg-amber-500/15 text-amber-600 dark:text-amber-400"
          />
          <SummaryCard
            icon={DollarSign}
            label="AI Cost"
            value={`$${formatCost(summary?.aiCostUsd ?? 0)}`}
            tint="bg-violet-500/15 text-violet-600 dark:text-violet-400"
          />
        </div>
      )}

      {/* Charts Section */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Monthly Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Monthly Trend
            </CardTitle>
            <CardDescription>
              Chats and leads over the selected period
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : trend.length === 0 ? (
              <EmptyBlock text="No activity in this period." />
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={trend.map((t) => ({
                      ...t,
                      label: formatMonthLabel(t.month),
                    }))}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="anChats" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={BRAND_BLUE}
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="95%"
                          stopColor={BRAND_BLUE}
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient id="anLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={BRAND_GREEN}
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="95%"
                          stopColor={BRAND_GREEN}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      minTickGap={8}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={32}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) => [
                        formatNumber(Number(value)),
                        name,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="chats"
                      name="Chats"
                      stroke={BRAND_BLUE}
                      strokeWidth={2}
                      fill="url(#anChats)"
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="leads"
                      name="Leads"
                      stroke={BRAND_GREEN}
                      strokeWidth={2}
                      fill="url(#anLeads)"
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leads by Source */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-accent-foreground" />
              Leads by Source
            </CardTitle>
            <CardDescription>
              Distribution of lead acquisition channels
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : sources.length === 0 ? (
              <EmptyBlock text="No leads captured in this period." />
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sources.map((s) => ({
                      name: prettify(s.source),
                      count: s.count,
                      key: s.source,
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="var(--border)"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={96}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [
                        formatNumber(Number(value)),
                        "Leads",
                      ]}
                    />
                    <Bar
                      dataKey="count"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={26}
                    >
                      {sources.map((s) => (
                        <Cell key={s.source} fill={sourceColor(s.source)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Breakdown Section */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Leads by Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Leads by Status
            </CardTitle>
            <CardDescription>Pipeline stage distribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : leadStatuses.length === 0 ? (
              <EmptyBlock text="No leads to display in this period." />
            ) : (
              <LeadsByStatusList items={leadStatuses} />
            )}
          </CardContent>
        </Card>

        {/* AI Usage by Feature */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              AI Usage by Feature
            </CardTitle>
            <CardDescription>
              Requests and token consumption per AI feature
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : features.length === 0 ? (
              <EmptyBlock text="No AI usage recorded in this period." />
            ) : (
              <AiByFeatureList items={features} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tickets by Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TicketIcon className="h-4 w-4 text-rose-500" />
            Tickets by Status
          </CardTitle>
          <CardDescription>
            Distribution of support tickets across statuses
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-28" />
              ))}
            </div>
          ) : ticketStatuses.length === 0 ? (
            <EmptyBlock text="No support tickets in this period." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {ticketStatuses.map((s) => (
                <Badge
                  key={s.status}
                  variant="outline"
                  className={`gap-2 py-1 px-3 ${ticketBadgeClass(s.status)}`}
                >
                  <span className="font-medium">{prettify(s.status)}</span>
                  <span className="tabular-nums bg-background/60 rounded px-1.5 py-0.5 text-[10px] font-semibold">
                    {s.count}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="space-y-2">
        <div
          className={`h-9 w-9 rounded-lg flex items-center justify-center ${tint}`}
        >
          <Icon size={18} />
        </div>
        <div className="text-2xl font-bold tracking-tight tabular-nums truncate">
          {value}
        </div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}

function LeadsByStatusList({ items }: { items: StatusItem[] }) {
  const total = items.reduce((a, b) => a + b.count, 0);
  return (
    <>
      {items.map((s) => {
        const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
        const color = statusColor(s.status);
        return (
          <div key={s.status} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium">{prettify(s.status)}</span>
              </span>
              <span className="font-medium tabular-nums">
                {formatNumber(s.count)}{" "}
                <span className="text-muted-foreground">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

function AiByFeatureList({ items }: { items: FeatureItem[] }) {
  const maxTokens = Math.max(...items.map((f) => f.tokens), 1);
  return (
    <>
      {items.map((f) => {
        const pct = Math.round((f.tokens / maxTokens) * 100);
        const color = featureColor(f.feature);
        return (
          <div key={f.feature} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium truncate">
                  {prettify(f.feature)}
                </span>
                <Badge
                  variant="secondary"
                  className="text-[10px] py-0 h-4 shrink-0"
                >
                  {f.count} req
                </Badge>
              </span>
              <span className="tabular-nums text-muted-foreground text-xs shrink-0 ml-2">
                {formatNumber(f.tokens)} tok
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[140px] items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
