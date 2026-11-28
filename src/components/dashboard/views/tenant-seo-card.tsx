"use client";

// Platform console → tenant: the tenant's SEO setup (Phase 3, workstream U).
// Shows each Search Console property and Business Profile location with its
// last access check; the platform can re-check or clear one. Locations also
// show their Google reviews state (workstream X) with a "Sync reviews" action.
// Keywords and content briefs (workstream Y): each brief can be copied as a
// page-builder prompt for a site the platform builds. Monthly SEO reports
// (workstream Z): create last month's and download the PDF.

import * as React from "react";
import { toast } from "sonner";
import { BarChart3, Copy, Download, FileText, Gauge, Loader2, Play, RefreshCw, SearchCheck, Star, Trash2 } from "lucide-react";
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
  locations: (Item & {
    title: string;
    address: string | null;
    averageRating: number | null;
    totalReviewCount: number | null;
    reviewsSyncedAt: string | null;
    reviewsError: string | null;
    metricsError: string | null;
    unreplied: number;
    awaitingApproval: number;
  })[];
  audit: Audit | null;
  content?: {
    keywords: number;
    opportunities: Record<string, number>;
    briefs: { id: string; query: string; title: string; gaps: number; createdAt: string; pagePrompt: string }[];
  };
  reports?: {
    lastMonth: string;
    items: { id: string; month: string; label: string; clicks: number | null; organicLeads: number; trigger: string; createdAt: string; emailedAt: string | null; emailError: string | null; aiError: string | null }[];
  };
}

const OPP_LABEL: Record<string, string> = { almost_page_one: "almost page one", low_ctr: "low click-through", cannibalisation: "split across pages" };

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

  const reviewsLine = (l: Data["locations"][number]) => (
    <div className="mt-1 space-y-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
        <Star className="h-3 w-3" />
        {l.totalReviewCount != null ? `${l.averageRating?.toFixed(1) ?? "-"}★ from ${l.totalReviewCount} reviews` : "Reviews not synced yet"}
        {l.unreplied > 0 && <span className="text-amber-700 dark:text-amber-400">{l.unreplied} unreplied</span>}
        {l.awaitingApproval > 0 && <span>{l.awaitingApproval} awaiting approval</span>}
        {l.reviewsSyncedAt && <span>synced {new Date(l.reviewsSyncedAt).toLocaleString()}</span>}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          disabled={!!busy || l.status === "lost_access"}
          onClick={() => post({ action: "sync_reviews", itemId: l.id }, `sync-${l.id}`, "Reviews sync queued.")}
        >
          {busy === `sync-${l.id}` ? "Queuing…" : "Sync reviews"}
        </button>
      </div>
      {l.reviewsError && <div className="text-amber-700 dark:text-amber-400">{l.reviewsError}</div>}
      {l.metricsError && <div className="text-amber-700 dark:text-amber-400">{l.metricsError}</div>}
    </div>
  );

  const row = (kind: "property" | "location", it: Item, name: string, sub: string | null, extra?: React.ReactNode) => (
    <div key={it.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          <Badge variant={it.status === "active" ? "secondary" : "destructive"}>{it.status === "active" ? "OK" : it.status === "lost_access" ? "Access lost" : "Error"}</Badge>
        </div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        {it.error && <div className="text-xs text-amber-700 dark:text-amber-400">{it.error}</div>}
        <div className="text-xs text-muted-foreground">{it.lastCheckedAt ? `Checked ${new Date(it.lastCheckedAt).toLocaleString()}` : "Not checked yet"}</div>
        {extra}
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
          <CardDescription>Search Console properties, Business Profile locations, the latest site audit, content briefs and monthly reports.</CardDescription>
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
            {data.locations.map((l) => row("location", l, l.title, l.address, reviewsLine(l)))}
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
        {data?.reports && (
          <div className="rounded-md border px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" /> Monthly reports
                </div>
                {data.reports.items.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No reports yet.</div>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs">
                    {data.reports.items.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">{r.label}</span>
                        <span className="text-muted-foreground">
                          {r.clicks != null ? `${r.clicks} clicks · ` : ""}
                          {r.organicLeads} organic leads · {r.trigger === "platform" ? "by platform" : r.trigger === "manual" ? "by tenant" : "scheduled"}
                          {r.emailedAt ? " · emailed" : ""}
                        </span>
                        {r.emailError && <span className="text-amber-700 dark:text-amber-400">{r.emailError}</span>}
                        {r.aiError && <span className="text-amber-700 dark:text-amber-400">{r.aiError}</span>}
                        <a className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground" href={`${url}?reportPdf=${r.id}`} download>
                          <Download className="h-3 w-3" /> PDF
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={() => post({ action: "report" }, "report", "Report created.")}>
                {busy === "report" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}Create {data.reports.lastMonth}
              </Button>
            </div>
          </div>
        )}
        {data?.content && (
          <div className="rounded-md border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" /> Keywords and content
            </div>
            <div className="text-xs text-muted-foreground">
              {data.content.keywords} tracked keywords
              {Object.entries(data.content.opportunities).map(([k, n]) => ` · ${n} ${OPP_LABEL[k] ?? k}`)}
            </div>
            {data.content.briefs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No content briefs yet.</div>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {data.content.briefs.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {b.title} <span className="text-muted-foreground">(&quot;{b.query}&quot;{b.gaps ? `, ${b.gaps} to add` : ""})</span>
                    </span>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 underline underline-offset-2 hover:text-foreground"
                      onClick={() => navigator.clipboard.writeText(b.pagePrompt).then(() => toast.success("Page-builder prompt copied."), () => toast.error("Couldn't copy."))}
                    >
                      <Copy className="h-3 w-3" /> Copy page-builder prompt
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
