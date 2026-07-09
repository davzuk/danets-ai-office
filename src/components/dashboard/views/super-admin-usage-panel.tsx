"use client";

import * as React from "react";
import { toast } from "sonner";
import { Gauge, RefreshCw, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface TenantUsageRow {
  businessId: string;
  businessName: string;
  plan: string;
  status: string;
  maxPercent: number;
  usage: {
    chats: number;
    leads: number;
    kbItems: number;
    agents: number;
    aiRequests: number;
    limits: {
      chatLimit: number;
      leadLimit: number;
      kbLimit: number;
      agentLimit: number;
      aiLimit: number;
    };
    percent: {
      chats: number;
      leads: number;
      kbItems: number;
      agents: number;
      aiRequests: number;
    };
  };
}

function barClass(pct: number) {
  if (pct >= 90) return "[&_[data-slot=progress-indicator]]:bg-destructive";
  if (pct >= 70) return "[&_[data-slot=progress-indicator]]:bg-amber-500";
  return "[&_[data-slot=progress-indicator]]:bg-emerald-500";
}

function UsageBar({ label, used, limit, pct }: { label: string; used: number; limit: number; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">
          {used.toLocaleString()} / {limit.toLocaleString()} ({pct}%)
        </span>
      </div>
      <Progress value={pct} className={cn("h-1.5", barClass(pct))} />
    </div>
  );
}

export function SuperAdminUsagePanel() {
  const [rows, setRows] = React.useState<TenantUsageRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      const res = await fetch(`/api/super-admin/usage?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setRows(data.tenants || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [debounced]);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Tenant Usage Quotas
            </CardTitle>
            <CardDescription>
              Monthly usage vs plan limits across all tenants. Sorted by highest utilization.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tenants..."
            className="pl-9 h-10"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-6 pb-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No tenants found.
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="pl-6 min-w-[180px]">Tenant</TableHead>
                  <TableHead className="min-w-[90px]">Plan</TableHead>
                  <TableHead className="min-w-[90px]">Peak</TableHead>
                  <TableHead className="min-w-[320px]">Usage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.businessId}>
                    <TableCell className="pl-6">
                      <div className="font-medium text-sm">{row.businessName}</div>
                      <div className="text-xs text-muted-foreground capitalize">{row.status}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {row.plan}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "tabular-nums",
                          row.maxPercent >= 90
                            ? "bg-destructive/15 text-destructive"
                            : row.maxPercent >= 70
                              ? "bg-amber-500/15 text-amber-700"
                              : "bg-emerald-500/15 text-emerald-700"
                        )}
                      >
                        {row.maxPercent}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2 py-1 pr-4">
                        <UsageBar
                          label="Chats"
                          used={row.usage.chats}
                          limit={row.usage.limits.chatLimit}
                          pct={row.usage.percent.chats}
                        />
                        <UsageBar
                          label="Leads"
                          used={row.usage.leads}
                          limit={row.usage.limits.leadLimit}
                          pct={row.usage.percent.leads}
                        />
                        <UsageBar
                          label="KB"
                          used={row.usage.kbItems}
                          limit={row.usage.limits.kbLimit}
                          pct={row.usage.percent.kbItems}
                        />
                        <UsageBar
                          label="AI"
                          used={row.usage.aiRequests}
                          limit={row.usage.limits.aiLimit}
                          pct={row.usage.percent.aiRequests}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UsageQuotaSummary({
  usage,
}: {
  usage: TenantUsageRow["usage"];
}) {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Gauge className="h-3.5 w-3.5" /> Plan Usage (this month)
      </div>
      <UsageBar label="Chats" used={usage.chats} limit={usage.limits.chatLimit} pct={usage.percent.chats} />
      <UsageBar label="Leads" used={usage.leads} limit={usage.limits.leadLimit} pct={usage.percent.leads} />
      <UsageBar label="KB Items" used={usage.kbItems} limit={usage.limits.kbLimit} pct={usage.percent.kbItems} />
      <UsageBar label="AI Agents" used={usage.agents} limit={usage.limits.agentLimit} pct={usage.percent.agents} />
      <UsageBar label="AI Requests" used={usage.aiRequests} limit={usage.limits.aiLimit} pct={usage.percent.aiRequests} />
    </div>
  );
}
