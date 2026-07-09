"use client";

import { useEffect, useState } from "react";
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
import {
  MessagesSquare,
  Users,
  Sparkles,
  DollarSign,
  TrendingUp,
  FileText,
  BookOpen,
  ArrowRight,
  Activity,
  Target,
  Zap,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import type { ViewId } from "@/components/dashboard/app-shell";
import { OnboardingChecklist } from "@/components/dashboard/shared/onboarding-checklist";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Stats {
  stats: {
    totalSessions: number;
    totalLeads: number;
    newLeads: number;
    aiUsageCount: number;
    aiTokens: number;
    aiCostUsd: number;
  };
  recentConversations: any[];
  recentQuotes: any[];
  topKb: any[];
  usageByFeature: { feature: string; count: number; tokens: number }[];
  series: { date: string; label: string; leads: number; sessions: number }[];
  insights?: AnalyticsData["insights"];
  topQuestions?: AnalyticsData["topQuestions"];
  leadQuality?: AnalyticsData["leadQuality"];
  hourly?: AnalyticsData["hourly"];
}

interface AnalyticsData {
  insights: {
    deflectionRate: number;
    leadConversion: number;
    avgMessages: number;
    aiSuccessRate: number;
    totalSessions: number;
    totalLeads: number;
    aiRequests: number;
  };
  topQuestions: { question: string; count: number }[];
  leadQuality: { high: number; medium: number; low: number };
  hourly: { hour: string; count: number }[];
}

export function OverviewView({
  user,
  onNavigate,
}: {
  user: any;
  onNavigate: (v: ViewId) => void;
}) {
  const [data, setData] = useState<Stats | null>(null);
  const [analyticsLocked, setAnalyticsLocked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setData(d?.stats ? d : null);
      })
      .finally(() => setLoading(false));

    fetch("/api/analytics", { cache: "no-store" }).then((r) => {
      if (!r.ok) {
        setAnalyticsLocked(r.status === 403);
      }
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const s = data?.stats;
  const insights = data?.insights;
  const topQuestions = data?.topQuestions ?? [];
  const leadQuality = data?.leadQuality ?? { high: 0, medium: 0, low: 0 };
  const featureColors: Record<string, string> = {
    chat: "var(--chart-1)",
    suggested_reply: "var(--chart-2)",
    quote: "var(--chart-4)",
    summary: "var(--chart-3)",
  };

  return (
    <div className="space-y-6">
      {/* Hero greeting */}
      <div className="rounded-2xl brand-gradient text-white p-6 sm:p-8 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, white 1px, transparent 1px), radial-gradient(circle at 85% 80%, white 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-up">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white/90 mb-3 backdrop-blur-sm">
              <Sparkles size={12} />
              AI Automation Dashboard
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Welcome back, <span className="text-white/90">{user.name.split(" ")[0]}</span> 👋
            </h1>
            <p className="text-white/85 mt-1.5 max-w-xl">
              Here&apos;s what&apos;s happening at {user.businessName} today.
              Your AI assistant is online and capturing leads.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="bg-white/15 text-white border-white/20 hover:bg-white/25"
              onClick={() => onNavigate("embed")}
            >
              Get embed code
            </Button>
            <Button
              className="bg-white text-primary hover:bg-white/90"
              onClick={() => onNavigate("agent")}
            >
              Configure AI
            </Button>
          </div>
        </div>
      </div>

      <OnboardingChecklist businessId={user.businessId} onNavigate={onNavigate} />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={MessagesSquare}
          label="Chat Sessions"
          value={s?.totalSessions ?? 0}
          tint="text-primary"
          onClick={() => onNavigate("conversations")}
        />
        <StatCard
          icon={Users}
          label="Total Leads"
          value={s?.totalLeads ?? 0}
          sub={`${s?.newLeads ?? 0} new`}
          tint="text-accent-foreground"
          accent
          onClick={() => onNavigate("leads")}
        />
        <StatCard
          icon={Sparkles}
          label="AI Requests"
          value={s?.aiUsageCount ?? 0}
          sub={`${(s?.aiTokens ?? 0).toLocaleString()} tokens`}
          tint="text-foreground"
          onClick={() => onNavigate("usage")}
        />
        <StatCard
          icon={DollarSign}
          label="Est. AI Cost"
          value={`$${(s?.aiCostUsd ?? 0).toFixed(2)}`}
          sub="this period"
          tint="text-foreground"
          onClick={() => onNavigate("usage")}
        />
      </div>

      {/* Chart + usage by feature */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Activity (7 days)</CardTitle>
              <CardDescription>Sessions and leads over time</CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1">
              <TrendingUp size={12} /> Live
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.series || []}>
                  <defs>
                    <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gL" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sessions"
                    name="Sessions"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#gS)"
                  />
                  <Area
                    type="monotone"
                    dataKey="leads"
                    name="Leads"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    fill="url(#gL)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} /> AI Usage by Feature
            </CardTitle>
            <CardDescription>Requests distribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.usageByFeature || []).length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No usage yet. Once visitors chat, stats appear here.
              </p>
            )}
            {(data?.usageByFeature || []).map((f) => {
              const total = (data?.usageByFeature || []).reduce(
                (a, b) => a + b.count,
                0
              );
              const pct = total > 0 ? (f.count / total) * 100 : 0;
              return (
                <div key={f.feature} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize">
                      {f.feature.replace("_", " ")}
                    </span>
                    <span className="text-muted-foreground">{f.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: featureColors[f.feature] || "var(--primary)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* AI Insights — available on all plans via dashboard stats */}
      {insights && (
        <div className="grid gap-4 lg:grid-cols-4">
          {/* Insight stat cards */}
          <InsightCard
            icon={CheckCircle2}
            label="AI Deflection Rate"
            value={`${insights.deflectionRate}%`}
            sub="Sessions resolved without handover"
            color="text-accent-foreground"
            bg="bg-accent/15"
          />
          <InsightCard
            icon={Target}
            label="Lead Conversion"
            value={`${insights.leadConversion}%`}
            sub="Sessions that became leads"
            color="text-primary"
            bg="bg-primary/10"
          />
          <InsightCard
            icon={MessagesSquare}
            label="Avg Messages/Session"
            value={String(insights.avgMessages)}
            sub="Engagement depth"
            color="text-foreground"
            bg="bg-muted"
          />
          <InsightCard
            icon={Zap}
            label="AI Success Rate"
            value={`${insights.aiSuccessRate}%`}
            sub={`${insights.aiRequests} requests (30d)`}
            color="text-accent-foreground"
            bg="bg-accent/15"
          />
        </div>
      )}

      {analyticsLocked && (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-medium">Advanced Analytics module</p>
              <p className="text-sm text-muted-foreground">
                Upgrade to Starter for the full Analytics dashboard with date ranges and reports.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigate("subscription")}>
              View plans
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Top Questions + Lead Quality */}
      {insights && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <HelpCircle size={16} /> Top Visitor Questions
              </CardTitle>
              <CardDescription>Most asked questions (30 days)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topQuestions.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No visitor questions yet. Once people chat with your widget,
                  the most common questions appear here.
                </p>
              )}
              {topQuestions.map((q, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                >
                  <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm truncate">{q.question}?</span>
                  <Badge variant="secondary" className="tabular-nums">
                    {q.count}×
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target size={16} /> Lead Quality Distribution
              </CardTitle>
              <CardDescription>30-day lead breakdown by quality</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const total =
                  leadQuality.high + leadQuality.medium + leadQuality.low;
                if (total === 0) {
                  return (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No leads yet. Leads captured by your AI widget appear here.
                    </p>
                  );
                }
                return (
                  <div className="space-y-3">
                    <QualityBar
                      label="High quality"
                      count={leadQuality.high}
                      total={total}
                      color="bg-destructive"
                      textClass="text-destructive"
                    />
                    <QualityBar
                      label="Medium quality"
                      count={leadQuality.medium}
                      total={total}
                      color="bg-accent"
                      textClass="text-accent-foreground"
                    />
                    <QualityBar
                      label="Low quality"
                      count={leadQuality.low}
                      total={total}
                      color="bg-muted-foreground"
                      textClass="text-muted-foreground"
                    />
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent conversations + recent quotes + top KB */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessagesSquare size={16} /> Recent Conversations
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("conversations")}>
              View all <ArrowRight size={14} />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto scroll-thin">
            {(data?.recentConversations || []).length === 0 && (
              <EmptyMini text="No conversations yet" />
            )}
            {(data?.recentConversations || []).map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 cursor-pointer transition-colors"
                onClick={() => onNavigate("conversations")}
              >
                <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                  {(c.visitorName || c.visitorEmail || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {c.visitorName || c.visitorEmail || "Anonymous visitor"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.lastMessage || "No messages"}
                  </div>
                </div>
                {c.leadQuality && (
                  <Badge
                    variant="outline"
                    className={
                      c.leadQuality === "high"
                        ? "border-destructive/30 text-destructive"
                        : c.leadQuality === "medium"
                        ? "border-accent text-accent-foreground"
                        : ""
                    }
                  >
                    {c.leadQuality}
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText size={16} /> Recent Quotes
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("quotes")}>
              New <ArrowRight size={14} />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto scroll-thin">
            {(data?.recentQuotes || []).length === 0 && (
              <EmptyMini text="No quotes generated yet" />
            )}
            {(data?.recentQuotes || []).map((q) => (
              <div
                key={q.id}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 cursor-pointer transition-colors"
                onClick={() => onNavigate("quotes")}
              >
                <div className="h-9 w-9 rounded-lg bg-accent/20 text-accent-foreground flex items-center justify-center shrink-0">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{q.clientName}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {q.service}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    q.status === "generated"
                      ? "border-accent text-accent-foreground"
                      : ""
                  }
                >
                  {q.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen size={16} /> Top Knowledge
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("knowledge")}>
              Manage <ArrowRight size={14} />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto scroll-thin">
            {(data?.topKb || []).length === 0 && (
              <EmptyMini text="No knowledge base items" />
            )}
            {(data?.topKb || []).map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 cursor-pointer transition-colors"
                onClick={() => onNavigate("knowledge")}
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <BookOpen size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{k.title}</div>
                  <div className="text-xs text-muted-foreground">{k.category}</div>
                </div>
                <Badge variant="secondary">{k.views} views</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tint,
  accent,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tint: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className="hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer group relative overflow-hidden"
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {label}
            </p>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${
              accent ? "bg-accent/20" : "bg-primary/10"
            } ${tint}`}
          >
            <Icon size={20} />
          </div>
        </div>
      </CardContent>
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${accent ? "bg-accent" : "bg-primary"} scale-x-0 group-hover:scale-x-100 transition-transform origin-left`} />
    </Card>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-sm text-muted-foreground">{text}</div>
  );
}

function InsightCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  bg,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  sub: string;
  color: string;
  bg: string;
}) {
  return (
    <Card className="relative overflow-hidden group hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className={`h-9 w-9 rounded-lg ${bg} ${color} flex items-center justify-center`}>
            <Icon size={18} />
          </div>
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-0.5">
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}

function QualityBar({
  label,
  count,
  total,
  color,
  textClass,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  textClass: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
          {label}
        </span>
        <span className="font-medium tabular-nums">
          {count} <span className="text-muted-foreground">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
