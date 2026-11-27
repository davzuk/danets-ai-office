"use client";

// Platform console → tenant: the tenant's SEO setup (Phase 3, workstream U).
// Shows each Search Console property and Business Profile location with its
// last access check; the platform can re-check or clear one.

import * as React from "react";
import { toast } from "sonner";
import { Gauge, Loader2, Play, RefreshCw, SearchCheck, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Item {
  id: string;
  status: string;
  error: string | null;
  lastCheckedAt: string | null;
}
interface Audit {
  id: string;
  rootUrl: string;
  status: string;
  trigger: string;
  score: number | null;
  pagesCrawled: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  top: { code: string; count: number; label: string; severity: string }[];
}
interface Data {
  properties: (Item & { siteUrl: string; permission: string })[];
  locations: (Item & { title: string; address: string | null })[];
  audit: Audit | null;
}

export function TenantSeoCard({ businessId }: { businessId: string }) {
  const [data, setData] = React.useState<Data | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const url = `/api/super-admin/businesses/${businessId}/seo`;

  React.useEffect(() => {
    let live = true;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setData(d.properties ? d : { properties: [], locations: [], audit: null }))
      .catch(() => live && setData({ properties: [], locations: [], audit: null }));
    return () => {
      live = false;
    };
  }, [url]);

  async function post(body: Record<string, unknown>, key: string, done: string) {
    setBusy(key);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed");
      setData(d);
      toast.success(done);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const row = (kind: "property" | "location", it: Item, name: string, sub: string | null) => (
    <div key={it.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          <Badge variant={it.status === "active" ? "secondary" : "destructive"}>{it.status === "active" ? "OK" : it.status === "lost_access" ? "Access lost" : "Error"}</Badge>
        </div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        {it.error && <div className="text-xs text-amber-700 dark:text-amber-400">{it.error}</div>}
        <div className="text-xs text-muted-foreground">{it.lastCheckedAt ? `Checked ${new Date(it.lastCheckedAt).toLocaleString()}` : "Not checked yet"}</div>
      </div>
      <Button variant="ghost" size="icon" title="Clear" disabled={!!busy} onClick={() => post({ action: "remove", kind, itemId: it.id }, it.id, "Cleared.")}>
        {busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </div>
  );

  const empty = data && data.properties.length + data.locations.length === 0;
  const a = data?.audit ?? null;
  const auditRunning = a?.status === "queued" || a?.status === "running";
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCheck className="h-4 w-4 text-primary" /> SEO setup
          </CardTitle>
          <CardDescription>Search Console properties, Business Profile locations and the latest site audit.</CardDescription>
        </div>
        {data && !empty && (
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => post({ action: "check" }, "check", "Checked with Google.")}>
            {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Check now
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {!data ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : empty ? (
          <p className="text-sm text-muted-foreground">Nothing connected.</p>
        ) : (
          <>
            {data.properties.map((p) => row("property", p, p.siteUrl.replace(/^sc-domain:/, ""), p.siteUrl.startsWith("sc-domain:") ? "Domain property" : "URL-prefix property"))}
            {data.locations.map((l) => row("location", l, l.title, l.address))}
          </>
        )}
        {data && (
          <div className="rounded-md border px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <Gauge className="h-4 w-4 text-muted-foreground" /> Site audit
                  {a && a.status === "done" && <Badge variant="secondary">{a.score}/100</Badge>}
                  {a && a.status === "failed" && <Badge variant="destructive">Failed</Badge>}
                  {auditRunning && <Badge variant="outline">Running</Badge>}
                </div>
                {a ? (
                  <>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.rootUrl} · {a.pagesCrawled} pages · {new Date(a.finishedAt ?? a.createdAt).toLocaleString()}
                      {a.trigger === "platform" ? " · run by platform" : a.trigger === "schedule" ? " · monthly" : ""}
                    </div>
                    {a.error && <div className="text-xs text-amber-700 dark:text-amber-400">{a.error}</div>}
                    {a.top.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {a.top.map((t) => (
                          <li key={t.code} className="flex items-center gap-1.5">
                            <span className={t.severity === "critical" ? "text-red-600 dark:text-red-400" : t.severity === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                              {t.severity === "critical" ? "Critical" : t.severity === "warning" ? "Warning" : "Notice"}
                            </span>
                            {t.label} ({t.count})
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">Not audited yet.</div>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={!!busy || auditRunning} onClick={() => post({ action: "audit" }, "audit", "Audit started.")}>
                {busy === "audit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run audit
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
