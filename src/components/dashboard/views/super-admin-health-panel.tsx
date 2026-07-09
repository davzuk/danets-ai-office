"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  HeartPulse,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface HealthRow {
  businessId: string;
  businessName: string;
  plan: string;
  status: string;
  subscriptionStatus: string | null;
  score: number;
  level: "healthy" | "at_risk" | "critical";
  alerts: string[];
  lastActiveAt: string | null;
  usagePercent: number;
}

const LEVEL_STYLES = {
  healthy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  at_risk: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  critical: "bg-destructive/15 text-destructive",
};

export function SuperAdminHealthPanel({
  onViewTenant,
}: {
  onViewTenant?: (id: string) => void;
}) {
  const [rows, setRows] = React.useState<HealthRow[]>([]);
  const [summary, setSummary] = React.useState({ healthy: 0, atRisk: 0, critical: 0 });
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [level, setLevel] = React.useState("all");
  const [bulkLoading, setBulkLoading] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (level !== "all") params.set("level", level);
      const res = await fetch(`/api/super-admin/health?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setRows(data.tenants || []);
      setSummary(data.summary || { healthy: 0, atRisk: 0, critical: 0 });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load health data");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search, level]);

  async function runBulk(action: string) {
    setBulkLoading(action);
    try {
      const res = await fetch("/api/super-admin/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk action failed");
      toast.success(`Bulk action completed: ${action.replace(/_/g, " ")}`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <div>
              <div className="text-2xl font-bold">{summary.healthy}</div>
              <div className="text-xs text-muted-foreground">Healthy</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div>
              <div className="text-2xl font-bold">{summary.atRisk}</div>
              <div className="text-xs text-muted-foreground">At risk</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <XCircle className="h-8 w-8 text-destructive" />
            <div>
              <div className="text-2xl font-bold">{summary.critical}</div>
              <div className="text-xs text-muted-foreground">Critical</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <HeartPulse className="h-4 w-4" /> Tenant Health
            </CardTitle>
            <CardDescription>
              Composite score from billing, activity, and quota usage.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!bulkLoading}
              onClick={() => runBulk("suspend_past_due")}
            >
              {bulkLoading === "suspend_past_due" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Suspend past due
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!bulkLoading}
              onClick={() => runBulk("activate_suspended")}
            >
              {bulkLoading === "activate_suspended" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Activate suspended
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!bulkLoading}
              onClick={() => runBulk("apply_retention_all")}
            >
              {bulkLoading === "apply_retention_all" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Apply retention
            </Button>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Search tenants…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-xs"
            />
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="at_risk">At risk</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Alerts</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.businessId}>
                    <TableCell>
                      <div className="font-medium">{r.businessName}</div>
                      <div className="text-xs text-muted-foreground capitalize">{r.plan}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={LEVEL_STYLES[r.level]}>{r.score}</Badge>
                    </TableCell>
                    <TableCell className="text-xs capitalize">
                      {r.status}
                      {r.subscriptionStatus && (
                        <span className="text-muted-foreground"> · {r.subscriptionStatus}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">{r.usagePercent}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {r.alerts.join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {onViewTenant && (
                        <Button size="sm" variant="ghost" onClick={() => onViewTenant(r.businessId)}>
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
