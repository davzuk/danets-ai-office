"use client";

import * as React from "react";
import { toast } from "sonner";
import { Cog, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface QueueStats {
  counts: { queued: number; running: number; succeeded: number; dead: number };
  due: number;
  oldestDueAgeSec: number | null;
}

interface DeadJob {
  id: string;
  type: string;
  businessId: string | null;
  attempts: number;
  lastError: string | null;
  finishedAt: string | null;
}

function formatAge(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

/** Background job queue health for the platform console. */
export function SuperAdminJobsCard() {
  const [stats, setStats] = React.useState<QueueStats | null>(null);
  const [dead, setDead] = React.useState<DeadJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // Callers that want a spinner set `loading` first (see Refresh).
  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setStats(data.stats);
      setDead(data.dead || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load job queue");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(action: "retry" | "discard", id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/super-admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      toast.success(action === "retry" ? "Job re-queued" : "Job discarded");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  // A backlog older than 5 minutes means no worker or cron is draining the queue.
  const stalled = (stats?.oldestDueAgeSec ?? 0) > 300;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Cog className="h-4 w-4" /> Background Jobs
          </CardTitle>
          <CardDescription>Queue depth and jobs that ran out of retries.</CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoading(true);
            load();
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? "mr-1 h-3 w-3 animate-spin" : "mr-1 h-3 w-3"} /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !stats ? (
          <Skeleton className="h-16 w-full" />
        ) : stats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Due now", stats.due],
              ["Running", stats.counts.running],
              ["Scheduled", Math.max(0, stats.counts.queued - stats.due)],
              ["Dead", stats.counts.dead],
              ["Oldest due", formatAge(stats.oldestDueAgeSec)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <div className="text-xl font-semibold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        ) : null}

        {stalled && (
          <p className="text-sm text-destructive">
            Jobs have been waiting over 5 minutes — check that the worker (<code>npm run worker</code>) or the{" "}
            <code>/api/cron/jobs</code> cron is running.
          </p>
        )}

        {dead.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dead.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>
                    <Badge variant="outline">{j.type}</Badge>
                  </TableCell>
                  <TableCell>{j.attempts}</TableCell>
                  <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground" title={j.lastError ?? ""}>
                    {j.lastError ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {j.finishedAt ? new Date(j.finishedAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" disabled={busyId === j.id} onClick={() => act("retry", j.id)}>
                      {busyId === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      <span className="sr-only sm:not-sr-only sm:ml-1">Retry</span>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === j.id} onClick={() => act("discard", j.id)}>
                      <Trash2 className="h-3 w-3" />
                      <span className="sr-only">Discard</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
