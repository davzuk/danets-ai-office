"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CircleDollarSign,
  Cpu,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface UsageUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface FeatureAgg {
  feature: string;
  count: number;
  tokens: number;
  costUsd: number;
}

interface DayAgg {
  date: string;
  count: number;
  tokens: number;
}

interface RecentLog {
  id: string;
  feature: string;
  totalTokens: number;
  costUsd: number;
  status: string;
  error: string | null;
  createdAt: string;
}

interface UsageData {
  totals: {
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    errorCount: number;
  };
  byFeature: FeatureAgg[];
  byDay: DayAgg[];
  recent: RecentLog[];
}

const BRAND_BLUE = "#1d4ed8";
const BRAND_GREEN = "#84cc16";

const FEATURE_META: Record<
  string,
  { label: string; color: string; description: string; progressClass: string }
> = {
  chat: {
    label: "Chat",
    color: BRAND_BLUE,
    description: "Widget & dashboard chat completions",
    progressClass: "[&_[data-slot=progress-indicator]]:bg-blue-700",
  },
  suggested_reply: {
    label: "Suggested Reply",
    color: BRAND_GREEN,
    description: "Agent-assist reply suggestions",
    progressClass: "[&_[data-slot=progress-indicator]]:bg-lime-500",
  },
  quote: {
    label: "Quote / Proposal",
    color: "#0ea5e9",
    description: "AI-generated quotes & proposals",
    progressClass: "[&_[data-slot=progress-indicator]]:bg-sky-500",
  },
  summary: {
    label: "Summary",
    color: "#f59e0b",
    description: "Conversation & document summaries",
    progressClass: "[&_[data-slot=progress-indicator]]:bg-amber-500",
  },
};

function featureMeta(feature: string) {
  return (
    FEATURE_META[feature] ?? {
      label: feature,
      color: "#64748b",
      description: "Custom AI feature",
      progressClass: "[&_[data-slot=progress-indicator]]:bg-slate-500",
    }
  );
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function UsageView({ user: _user }: { user: UsageUser }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<"requests" | "tokens">("requests");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Unauthorized. Please sign in again.");
        } else {
          setError(`Failed to load usage (${res.status})`);
        }
        return;
      }
      const json = (await res.json()) as UsageData;
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const errorRate = useMemo(() => {
    if (!data) return 0;
    const total = data.totals.totalRequests;
    if (total === 0) return 0;
    return (data.totals.errorCount / total) * 100;
  }, [data]);

  const maxFeatureTokens = useMemo(() => {
    if (!data) return 1;
    const m = Math.max(...data.byFeature.map((f) => f.tokens), 1);
    return m;
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Usage &amp; Cost
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Token consumption, estimated spend and request activity across all AI features.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Requests"
            value={formatNumber(data?.totals.totalRequests ?? 0)}
            icon={<Activity className="h-4 w-4" />}
            accent="blue"
            hint="All-time AI calls"
          />
          <StatCard
            label="Total Tokens"
            value={formatNumber(data?.totals.totalTokens ?? 0)}
            icon={<Cpu className="h-4 w-4" />}
            accent="green"
            hint="Prompt + completion"
          />
          <StatCard
            label="Estimated Cost"
            value={`$${formatCost(data?.totals.totalCostUsd ?? 0)}`}
            icon={<CircleDollarSign className="h-4 w-4" />}
            accent="blue"
            hint="USD"
          />
          <StatCard
            label="Error Rate"
            value={`${errorRate.toFixed(1)}%`}
            icon={<AlertTriangle className="h-4 w-4" />}
            accent={errorRate > 5 ? "red" : "green"}
            hint={`${data?.totals.errorCount ?? 0} failed requests`}
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily activity chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">14-Day Activity</CardTitle>
              <CardDescription>
                Daily request volume and token consumption.
              </CardDescription>
            </div>
            <Tabs
              value={metric}
              onValueChange={(v) => setMetric(v as "requests" | "tokens")}
            >
              <TabsList className="h-8">
                <TabsTrigger value="requests" className="text-xs">
                  Requests
                </TabsTrigger>
                <TabsTrigger value="tokens" className="text-xs">
                  Tokens
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <DailyChart data={data?.byDay ?? []} metric={metric} />
            )}
          </CardContent>
        </Card>

        {/* Usage by feature */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage by Feature</CardTitle>
            <CardDescription>Relative token consumption.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (data?.byFeature ?? []).filter((f) => f.count > 0).length ===
              0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No usage recorded yet.
              </p>
            ) : (
              (data?.byFeature ?? []).map((f) => (
                <FeatureRow
                  key={f.feature}
                  feature={f}
                  pct={Math.round((f.tokens / maxFeatureTokens) * 100)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <CardDescription>
            Latest 50 AI requests across all features.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-6 pb-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="max-h-[50vh] overflow-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="pl-6">Time</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="pr-6 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.recent ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground py-8"
                      >
                        No AI activity yet. Once your widget starts chatting,
                        usage will appear here.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (data?.recent ?? []).map((r) => (
                      <RecentRow key={r.id} row={r} />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost note */}
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <CircleDollarSign className="h-3.5 w-3.5" />
        Cost is an estimate based on a flat rate of{" "}
        <span className="font-medium text-foreground">$0.002 per 1,000 tokens</span>{" "}
        and may differ from actual provider billing.
      </p>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  hint,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
  accent: "blue" | "green" | "red";
}) {
  const ring =
    accent === "blue"
      ? "text-primary bg-primary/10"
      : accent === "green"
      ? "text-[#4d7c0f] bg-accent/30"
      : "text-destructive bg-destructive/10";
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start gap-4">
        <div
          className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${ring}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </div>
          <div className="text-2xl font-bold tracking-tight mt-1 truncate">
            {value}
          </div>
          {hint && (
            <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Daily chart ────────────────────────────────────────────────────────

function DailyChart({
  data,
  metric,
}: {
  data: DayAgg[];
  metric: "requests" | "tokens";
}) {
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        date: shortDate(d.date),
        value: metric === "requests" ? d.count : d.tokens,
      })),
    [data, metric]
  );

  const color = metric === "requests" ? BRAND_BLUE : BRAND_GREEN;
  const gradientId = `usage-gradient-${metric}`;

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="oklch(0.92 0.01 240)"
          />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "oklch(0.5 0.02 250)" }}
            minTickGap={16}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "oklch(0.5 0.02 250)" }}
            width={48}
            allowDecimals={false}
          />
          <RechartsTooltip
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "4 4" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid oklch(0.92 0.01 240)",
              fontSize: 12,
              padding: "8px 10px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            }}
            labelStyle={{ color: "oklch(0.18 0.02 250)", fontWeight: 600 }}
            formatter={(value: number) => [
              metric === "requests"
                ? `${value} requests`
                : `${formatNumber(value)} tokens`,
              metric === "requests" ? "Requests" : "Tokens",
            ]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Feature row ────────────────────────────────────────────────────────

function FeatureRow({ feature, pct }: { feature: FeatureAgg; pct: number }) {
  const meta = featureMeta(feature.feature);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: meta.color }}
          />
          <span className="font-medium truncate">{meta.label}</span>
          <Badge variant="secondary" className="text-[10px] py-0 h-4">
            {feature.count}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          <span className="tabular-nums">
            {formatNumber(feature.tokens)} tok
          </span>
          <span className="tabular-nums font-medium text-foreground">
            ${formatCost(feature.costUsd)}
          </span>
        </div>
      </div>
      <Progress
        value={pct}
        className={`h-2 ${meta.progressClass}`}
      />
    </div>
  );
}

// ── Recent row ─────────────────────────────────────────────────────────

function RecentRow({ row }: { row: RecentLog }) {
  const meta = featureMeta(row.feature);
  const isError = row.status === "error";
  return (
    <TableRow>
      <TableCell className="pl-6 text-muted-foreground text-xs tabular-nums">
        {formatTime(row.createdAt)}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className="gap-1.5 font-medium"
          style={{
            color: meta.color,
            borderColor: `${meta.color}40`,
            backgroundColor: `${meta.color}10`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: meta.color }}
          />
          {meta.label}
        </Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatNumber(row.totalTokens)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        ${formatCost(row.costUsd)}
      </TableCell>
      <TableCell className="pr-6 text-right">
        {isError ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Badge
                  variant="destructive"
                  className="cursor-help"
                >
                  Error
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {row.error || "Unknown error"}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Badge
            className="bg-accent/30 text-[#4d7c0f] border-transparent hover:bg-accent/40"
          >
            Success
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
