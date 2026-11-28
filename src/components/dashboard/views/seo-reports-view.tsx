"use client";

// SEO (Phase 3, workstream Z). The monthly SEO report: search clicks and
// organic leads, top movers, the site audit, reviews and Business Profile
// actions, with three AI "do this next" points. Downloadable as a PDF in the
// tenant's white-label brand, and emailed to admins on the 3rd of each month.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BarChart3, Download, Loader2, Mail, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface Mover {
  query: string;
  clicks: number;
  previousClicks: number;
  change: number;
  position: number;
}
interface LocalTotals {
  searchViews: number;
  mapsViews: number;
  calls: number;
  websiteClicks: number;
  directions: number;
  messages: number;
}
interface ReportData {
  month: string;
  from: string;
  to: string;
  businessName: string;
  search: { siteUrl: string; complete: boolean; totals: Totals; previous: Totals; gainers: Mover[]; losers: Mover[]; topPages: { page: string; clicks: number; impressions: number; leads: number }[] } | null;
  leads: { organic: number; previous: number };
  audit: { rootUrl: string; score: number | null; previousScore: number | null; finishedAt: string | null; inMonth: boolean; pagesCrawled: number; fixed: number | null; added: number | null; top: { label: string; count: number; severity: string }[] } | null;
  reviews: { count: number; previous: number; averageRating: number | null; replied: number; replyRate: number | null; overallRating: number | null; totalReviews: number } | null;
  local: { totals: LocalTotals; previous: LocalTotals } | null;
}
interface Summary {
  id: string;
  month: string;
  label: string;
  clicks: number | null;
  organicLeads: number;
  trigger: string;
  createdAt: string;
  emailedAt: string | null;
  emailError: string | null;
}
interface Report extends Summary {
  data: ReportData;
  nextSteps: { summary: string; steps: { title: string; detail: string }[] } | null;
  aiError: string | null;
}
interface ListData {
  reports: Summary[];
  settings: { reportEmail: boolean };
  brand: { name: string; color: string; logoUrl: string | null; whiteLabel: boolean; poweredBy: boolean };
  lastMonth: string;
  canEdit: boolean;
}

async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

const fmt = (n: number) => Math.round(n).toLocaleString();
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || u;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev && !cur) return <span className="text-xs text-muted-foreground">No change</span>;
  if (!prev) return <span className="text-xs text-muted-foreground">New this month</span>;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return <span className="text-xs text-muted-foreground">Same as last month</span>;
  const good = invert ? d < 0 : d > 0;
  const p = Math.round((d / prev) * 100);
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {d > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(p)}% vs last month
    </span>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 min-h-4">{children}</div>
    </div>
  );
}

export function SeoReportsView() {
  const [list, setList] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (pick?: string) => {
    try {
      const d = await api<ListData>("/api/seo/reports");
      setList(d);
      setError(null);
      setSelected((cur) => pick ?? cur ?? d.reports[0]?.id ?? null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    api<{ report: Report }>(`/api/seo/reports/${selected}`).then(
      (d) => live && setReport(d.report),
      (e) => toast.error(e.message)
    );
    return () => {
      live = false;
    };
  }, [selected]);

  const create = async () => {
    setBusy("create");
    try {
      const r = await api<{ report: Report }>("/api/seo/reports", { method: "POST", json: { month: list?.lastMonth } });
      setReport(r.report);
      await load(r.report.id);
      toast.success("Report created.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const email = async () => {
    if (!report) return;
    setBusy("email");
    try {
      const r = await api<{ report: Report }>(`/api/seo/reports/${report.id}/email`, { method: "POST" });
      setReport(r.report);
      toast.success("Emailed to your admins.");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  const setEmail = async (reportEmail: boolean) => {
    setList((l) => (l ? { ...l, settings: { reportEmail } } : l));
    try {
      await api("/api/seo/reports", { method: "PATCH", json: { reportEmail } });
    } catch (e: any) {
      toast.error(e.message);
      load();
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!list) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  const hasLastMonth = list.reports.some((r) => r.month === list.lastMonth);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly SEO reports</h1>
          <p className="text-sm text-muted-foreground">
            A report on each month, ready on the 3rd once Google&apos;s numbers are final.
            {list.brand.whiteLabel ? ` Reports carry your ${list.brand.name} branding, so you can forward them to clients.` : ""}
          </p>
        </div>
        {list.canEdit && (
          <Button size="sm" onClick={create} disabled={!!busy}>
            {busy === "create" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
            {hasLastMonth ? `Re-create ${monthLabel(list.lastMonth)}` : `Create ${monthLabel(list.lastMonth)}`}
          </Button>
        )}
      </div>

      {list.canEdit && (
        <div className="flex items-center gap-2">
          <Switch id="seo-report-email" checked={list.settings.reportEmail} onCheckedChange={setEmail} />
          <Label htmlFor="seo-report-email" className="text-sm font-normal">
            Email each month&apos;s report (PDF) to admins
          </Label>
        </div>
      )}

      {list.reports.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No reports yet. The first one arrives on the 3rd of next month{list.canEdit ? ", or create last month's now" : ""}.</CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {list.reports.map((r) => (
              <Button key={r.id} size="sm" variant={selected === r.id ? "secondary" : "outline"} className="h-8" onClick={() => setSelected(r.id)}>
                {r.label}
              </Button>
            ))}
          </div>
          {!report || report.id !== selected ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <ReportPage report={report} canEdit={list.canEdit} onEmail={email} busy={busy} />}
        </>
      )}
    </div>
  );
}

function ReportPage({ report, canEdit, onEmail, busy }: { report: Report; canEdit: boolean; onEmail: () => void; busy: string | null }) {
  const d = report.data;
  const s = d.search;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>SEO report: {report.label}</CardTitle>
              <CardDescription>
                {d.from} to {d.to}
                {s ? ` · ${shortUrl(s.siteUrl)}` : ""}
                {report.emailedAt ? ` · Emailed ${new Date(report.emailedAt).toLocaleDateString()}` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/seo/reports/${report.id}?format=pdf`} download>
                  <Download className="mr-2 h-4 w-4" />
                  PDF
                </a>
              </Button>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={onEmail} disabled={!!busy}>
                  {busy === "email" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Email to admins
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.emailError && <p className="text-sm text-amber-700 dark:text-amber-400">Last email: {report.emailError}</p>}
          {report.nextSteps?.summary && <p className="text-sm">{report.nextSteps.summary}</p>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {s && (
              <Stat label="Clicks from Google" value={fmt(s.totals.clicks)}>
                <Delta cur={s.totals.clicks} prev={s.previous.clicks} />
              </Stat>
            )}
            {s && (
              <Stat label="Impressions" value={fmt(s.totals.impressions)}>
                <Delta cur={s.totals.impressions} prev={s.previous.impressions} />
              </Stat>
            )}
            {s && (
              <Stat label="Average position" value={s.totals.impressions ? s.totals.position.toFixed(1) : "—"}>
                <span className="text-xs text-muted-foreground">CTR {(s.totals.ctr * 100).toFixed(1)}%</span>
              </Stat>
            )}
            <Stat label="Leads from organic search" value={fmt(d.leads.organic)}>
              <Delta cur={d.leads.organic} prev={d.leads.previous} />
            </Stat>
          </div>
          {s && !s.complete && <p className="text-xs text-muted-foreground">Search Console data for the end of the month wasn&apos;t in yet, so search numbers may rise slightly.</p>}
          {!s && <p className="text-sm text-muted-foreground">No Search Console property is connected, so there are no search numbers.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Do this next
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.nextSteps ? (
            <ol className="space-y-3">
              {report.nextSteps.steps.map((st, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                  <div>
                    <div className="font-medium">{st.title}</div>
                    <p className="text-sm text-muted-foreground">{st.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{report.aiError ?? "No next steps in this report."}</p>
          )}
        </CardContent>
      </Card>

      {s && (s.gainers.length > 0 || s.losers.length > 0 || s.topPages.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top movers</CardTitle>
              <CardDescription>Searches that gained or lost the most clicks since last month.</CardDescription>
            </CardHeader>
            <CardContent>
              {s.gainers.length + s.losers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No movement this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Search</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Clicks</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Change</th>
                      <th className="py-1.5 text-right font-medium">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.gainers, ...s.losers].map((m) => (
                      <tr key={m.query} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">{m.query}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(m.clicks)}</td>
                        <td className={cn("py-1.5 pr-2 text-right tabular-nums", m.change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                          {m.change > 0 ? "+" : ""}
                          {fmt(m.change)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{m.position ? m.position.toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top pages</CardTitle>
              <CardDescription>The pages Google sent the most visitors to, and the leads they brought.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Page</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Clicks</th>
                    <th className="py-1.5 text-right font-medium">Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topPages.map((p) => (
                    <tr key={p.page} className="border-b last:border-0">
                      <td className="max-w-0 truncate py-1.5 pr-2" title={p.page}>
                        {shortUrl(p.page)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(p.clicks)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(p.leads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site audit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.audit ? (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">{d.audit.score ?? "—"}</span>
                  <span className="text-muted-foreground">/100</span>
                  {d.audit.previousScore != null && <span className="text-xs text-muted-foreground">was {d.audit.previousScore}</span>}
                  {!d.audit.inMonth && <Badge variant="outline">From before this month</Badge>}
                </div>
                <p className="text-muted-foreground">
                  {d.audit.fixed == null ? "The site's first audit" : `${d.audit.fixed} fixed and ${d.audit.added ?? 0} new since the previous audit`}, from {fmt(d.audit.pagesCrawled)} pages of {shortUrl(d.audit.rootUrl)}.
                </p>
                {d.audit.top.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {d.audit.top.map((t) => (
                      <li key={t.label}>
                        {t.label} ({t.count})
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No site audit yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reviews and Business Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.reviews ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">New reviews</div>
                  <div className="text-lg font-semibold tabular-nums">{d.reviews.count}</div>
                  <Delta cur={d.reviews.count} prev={d.reviews.previous} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Average rating</div>
                  <div className="text-lg font-semibold tabular-nums">{d.reviews.averageRating != null ? `${d.reviews.averageRating.toFixed(1)}★` : "—"}</div>
                  {d.reviews.overallRating != null && <div className="text-xs text-muted-foreground">{d.reviews.overallRating.toFixed(1)}★ overall</div>}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Replied to</div>
                  <div className="text-lg font-semibold tabular-nums">{d.reviews.replyRate != null ? `${Math.round(d.reviews.replyRate * 100)}%` : "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.reviews.replied} of {d.reviews.count}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No Business Profile location is connected.</p>
            )}
            {d.local && (
              <div className="grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-4">
                {(
                  [
                    ["Views", d.local.totals.searchViews + d.local.totals.mapsViews, d.local.previous.searchViews + d.local.previous.mapsViews],
                    ["Calls", d.local.totals.calls, d.local.previous.calls],
                    ["Website clicks", d.local.totals.websiteClicks, d.local.previous.websiteClicks],
                    ["Directions", d.local.totals.directions, d.local.previous.directions],
                  ] as const
                ).map(([label, cur, prev]) => (
                  <div key={label}>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold tabular-nums">{fmt(cur)}</div>
                    <Delta cur={cur} prev={prev} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
