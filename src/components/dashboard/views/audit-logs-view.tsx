"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  LogIn,
  Users,
  Bot,
  BookOpen,
  FileText,
  Ticket as TicketIcon,
  Building2,
  Plug,
  CreditCard,
  Search,
  RefreshCw,
  X,
  ShieldCheck,
  History,
  Globe,
  Filter,
  Inbox,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface UserProp {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  module: string;
  description: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
}

// ─── Module configuration ──────────────────────────────────────────
// Valid modules (order matches the Select dropdown).
const MODULES = [
  "auth",
  "team",
  "business",
  "agent",
  "knowledge",
  "leads",
  "quotes",
  "tickets",
  "documents",
  "integrations",
  "subscription",
] as const;

interface ModuleConfig {
  icon: LucideIcon;
  label: string;
  dotClass: string;
  iconBg: string;
  iconText: string;
  badgeClass: string;
}

const MODULE_CONFIG: Record<string, ModuleConfig> = {
  auth: {
    icon: LogIn,
    label: "Auth",
    dotClass: "bg-primary",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    badgeClass: "bg-primary/10 text-primary border-primary/20",
  },
  team: {
    icon: Users,
    label: "Team",
    dotClass: "bg-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-600 dark:text-emerald-400",
    badgeClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  business: {
    icon: Building2,
    label: "Business",
    dotClass: "bg-orange-500",
    iconBg: "bg-orange-500/10",
    iconText: "text-orange-600 dark:text-orange-400",
    badgeClass:
      "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  },
  agent: {
    icon: Bot,
    label: "AI Agent",
    dotClass: "bg-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-600 dark:text-violet-400",
    badgeClass:
      "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  },
  knowledge: {
    icon: BookOpen,
    label: "Knowledge Base",
    dotClass: "bg-cyan-500",
    iconBg: "bg-cyan-500/10",
    iconText: "text-cyan-600 dark:text-cyan-400",
    badgeClass:
      "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  },
  leads: {
    icon: Users,
    label: "Leads",
    dotClass: "bg-accent",
    iconBg: "bg-accent/30",
    iconText: "text-accent-foreground",
    badgeClass: "bg-accent/30 text-accent-foreground border-accent/40",
  },
  quotes: {
    icon: FileText,
    label: "Quotes",
    dotClass: "bg-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
    badgeClass:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  tickets: {
    icon: TicketIcon,
    label: "Tickets",
    dotClass: "bg-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-600 dark:text-rose-400",
    badgeClass:
      "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  },
  documents: {
    icon: FileText,
    label: "Documents",
    dotClass: "bg-teal-500",
    iconBg: "bg-teal-500/10",
    iconText: "text-teal-600 dark:text-teal-400",
    badgeClass:
      "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  },
  integrations: {
    icon: Plug,
    label: "Integrations",
    dotClass: "bg-fuchsia-500",
    iconBg: "bg-fuchsia-500/10",
    iconText: "text-fuchsia-600 dark:text-fuchsia-400",
    badgeClass:
      "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/20",
  },
  subscription: {
    icon: CreditCard,
    label: "Subscription",
    dotClass: "bg-lime-500",
    iconBg: "bg-lime-500/10",
    iconText: "text-lime-600 dark:text-lime-400",
    badgeClass:
      "bg-lime-500/10 text-lime-700 dark:text-lime-400 border-lime-500/20",
  },
};

const FALLBACK_CONFIG: ModuleConfig = {
  icon: History,
  label: "System",
  dotClass: "bg-muted-foreground",
  iconBg: "bg-muted",
  iconText: "text-muted-foreground",
  badgeClass: "bg-muted text-muted-foreground border-border",
};

function moduleConfig(module: string): ModuleConfig {
  return MODULE_CONFIG[module] ?? FALLBACK_CONFIG;
}

// ─── Formatting helpers ────────────────────────────────────────────
/** Title-case a snake_case identifier, e.g. "lead_status_changed" → "Lead Status Changed". */
function formatTitleCase(s: string): string {
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human-friendly date bucket label: Today / Yesterday / "<Weekday>, Mon D, YYYY". */
function dateKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dStart = new Date(d);
  dStart.setHours(0, 0, 0, 0);
  if (dStart.getTime() === today.getTime()) return "Today";
  if (dStart.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Sub-components ────────────────────────────────────────────────
function ModuleBadge({ module }: { module: string }) {
  const cfg = moduleConfig(module);
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] py-0 h-5 gap-1 font-medium", cfg.badgeClass)}
    >
      {cfg.label}
    </Badge>
  );
}

function ActionBadge({ action }: { action: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] py-0 h-5 font-medium bg-muted/60 text-muted-foreground border-border"
    >
      {formatTitleCase(action)}
    </Badge>
  );
}

function IpBadge({ ip }: { ip: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] py-0 h-5 font-mono text-muted-foreground/80 bg-card gap-1"
    >
      <Globe size={9} />
      {ip}
    </Badge>
  );
}

function DateHeader({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm py-2 flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function LogItem({
  log,
  showConnector,
}: {
  log: AuditLog;
  showConnector: boolean;
}) {
  const cfg = moduleConfig(log.module);
  const Icon = cfg.icon;
  const actor = log.userName?.trim() || "System";
  return (
    <div className="relative flex gap-3">
      {/* Left column: icon node + connector */}
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            "size-9 rounded-full flex items-center justify-center shrink-0 ring-4 ring-card z-10",
            cfg.iconBg
          )}
        >
          <Icon size={16} className={cfg.iconText} />
        </div>
        {showConnector && (
          <div
            className={cn(
              "w-px flex-1 min-h-[12px] my-1 opacity-30",
              cfg.dotClass
            )}
          />
        )}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0 pb-5 pt-0.5">
        <div className="text-sm leading-snug text-foreground break-words">
          {log.description}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{actor}</span>
          <span aria-hidden>·</span>
          <span title={fullDate(log.createdAt)}>
            {relativeTime(log.createdAt)}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <ModuleBadge module={log.module} />
          <ActionBadge action={log.action} />
          {log.ipAddress && <IpBadge ip={log.ipAddress} />}
        </div>
      </div>
    </div>
  );
}

function SkeletonLog() {
  return (
    <div className="relative flex gap-3">
      <div className="relative flex flex-col items-center">
        <Skeleton className="size-9 rounded-full ring-4 ring-card shrink-0" />
        <div className="w-px flex-1 min-h-[12px] my-1 bg-border opacity-30" />
      </div>
      <div className="flex-1 min-w-0 pb-5 pt-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-32" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  hasFilters,
  onRefresh,
  onClearFilters,
}: {
  hasFilters: boolean;
  onRefresh: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed py-16 px-6 text-center">
      <div className="mx-auto size-14 rounded-full bg-accent/20 flex items-center justify-center">
        <Inbox className="text-accent-foreground" size={26} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">
        {hasFilters ? "No matching activity" : "No activity yet"}
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-md mx-auto">
        {hasFilters
          ? "Try adjusting your search or module filter to find what you're looking for."
          : "Activity across your business — logins, settings changes, lead updates and more — will appear here as it happens."}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
        {hasFilters ? (
          <Button onClick={onClearFilters} variant="outline">
            <Filter size={14} /> Clear filters
          </Button>
        ) : (
          <Button onClick={onRefresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Timeline (groups entries by date) ────────────────────────────
function Timeline({ logs }: { logs: AuditLog[] }) {
  // Precompute per-entry visibility flags (pure, no mutation during render).
  const entries = logs.map((log, i) => {
    const key = dateKey(log.createdAt);
    const prevKey = i === 0 ? "" : dateKey(logs[i - 1].createdAt);
    const showHeader = key !== prevKey;
    const nextLog = logs[i + 1];
    const showConnector = !!nextLog && dateKey(nextLog.createdAt) === key;
    return { log, showHeader, showConnector, key };
  });

  return (
    <div className="relative">
      {entries.map(({ log, showHeader, showConnector, key }) => (
        <React.Fragment key={log.id}>
          {showHeader && <DateHeader label={key} />}
          <LogItem log={log} showConnector={showConnector} />
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────
export function AuditLogsView({ user }: { user: UserProp }) {
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [moduleFilter, setModuleFilter] = React.useState<string>("all");

  // ─── Debounce search input (350ms) ─────────────────────────────
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const hasFilters = !!search || moduleFilter !== "all";

  // ─── Fetch logs ────────────────────────────────────────────────
  const fetchLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (moduleFilter !== "all") params.set("module", moduleFilter);
      params.set("limit", "200");
      const res = await fetch(`/api/audit-logs?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load");
      const data: AuditLogsResponse = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Failed to load audit logs");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, moduleFilter]);

  React.useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setModuleFilter("all");
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-primary" size={22} />
            Audit Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track all activity across{" "}
            <span className="font-medium text-foreground">
              {user.businessName}
            </span>{" "}
            for security and accountability.
          </p>
        </div>

        {/* Total count info badge */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="bg-card gap-1.5 py-1 px-2.5 text-xs"
          >
            <History size={12} className="text-primary" />
            <span className="font-semibold">{total}</span>{" "}
            {total === 1 ? "entry" : "entries"}
          </Badge>
        </div>
      </div>

      {/* Toolbar */}
      <Card className="py-3">
        <CardContent className="px-3 sm:px-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search description or actor…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchInput && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-[170px]" size="sm">
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {MODULES.map((m) => {
                  const cfg = moduleConfig(m);
                  return (
                    <SelectItem key={m} value={m}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("size-1.5 rounded-full", cfg.dotClass)}
                        />
                        {cfg.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground"
              >
                <X size={14} /> Clear
              </Button>
            )}

            <Button
              variant="outline"
              size="icon"
              onClick={() => fetchLogs()}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card className="py-0">
        <CardContent className="p-4 sm:p-5">
          {loading && logs.length === 0 ? (
            <div className="max-h-[70vh] overflow-y-auto scroll-thin pr-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonLog key={i} />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              hasFilters={hasFilters}
              onRefresh={fetchLogs}
              onClearFilters={clearFilters}
            />
          ) : (
            <div className="max-h-[70vh] overflow-y-auto scroll-thin pr-1">
              <Timeline logs={logs} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
