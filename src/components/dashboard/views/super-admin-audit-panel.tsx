"use client";

import * as React from "react";
import { toast } from "sonner";
import { History, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

interface AuditEntry {
  id: string;
  businessId: string;
  businessName: string;
  userId: string | null;
  userName: string | null;
  action: string;
  module: string;
  description: string;
  ipAddress: string | null;
  createdAt: string;
}

const MODULE_COLORS: Record<string, string> = {
  auth: "bg-violet-500/15 text-violet-700",
  team: "bg-blue-500/15 text-blue-700",
  business: "bg-slate-500/15 text-slate-700",
  agent: "bg-cyan-500/15 text-cyan-700",
  knowledge: "bg-emerald-500/15 text-emerald-700",
  leads: "bg-amber-500/15 text-amber-700",
  quotes: "bg-orange-500/15 text-orange-700",
  tickets: "bg-rose-500/15 text-rose-700",
  documents: "bg-indigo-500/15 text-indigo-700",
  integrations: "bg-teal-500/15 text-teal-700",
  subscription: "bg-primary/15 text-primary",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function SuperAdminAuditPanel({
  businesses,
}: {
  businesses: { id: string; name: string }[];
}) {
  const [logs, setLogs] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [businessFilter, setBusinessFilter] = React.useState("all");
  const [moduleFilter, setModuleFilter] = React.useState("all");

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "150" });
      if (debounced) params.set("q", debounced);
      if (businessFilter !== "all") params.set("businessId", businessFilter);
      if (moduleFilter !== "all") params.set("module", moduleFilter);
      const res = await fetch(`/api/super-admin/audit-logs?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [debounced, businessFilter, moduleFilter]);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Platform Audit Log
            </CardTitle>
            <CardDescription>
              Cross-tenant activity timeline for security review and accountability.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description or user..."
              className="pl-9 h-10"
            />
          </div>
          <Select value={businessFilter} onValueChange={setBusinessFilter}>
            <SelectTrigger className="w-full sm:w-[200px] h-10">
              <SelectValue placeholder="Tenant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tenants</SelectItem>
              {businesses.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-full sm:w-[160px] h-10">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {Object.keys(MODULE_COLORS).map((m) => (
                <SelectItem key={m} value={m} className="capitalize">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <History className="h-8 w-8 opacity-40" />
            No audit entries match your filters.
          </div>
        ) : (
          <div className="space-y-2 max-h-[70vh] overflow-auto scroll-thin pr-1">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs font-normal">
                    {log.businessName}
                  </Badge>
                  <Badge className={cn("text-xs capitalize", MODULE_COLORS[log.module] || "bg-muted")}>
                    {log.module}
                  </Badge>
                  <Badge variant="secondary" className="text-xs font-mono">
                    {log.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                    {timeAgo(log.createdAt)}
                  </span>
                </div>
                <p className="text-sm">{log.description}</p>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                  {log.userName && <span>{log.userName}</span>}
                  {log.ipAddress && <span>IP {log.ipAddress}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
