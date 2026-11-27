"use client";

// SEO (Phase 3, workstream W). The site audit: Danets crawls the tenant's own
// website, lists what hurts it in Google (grouped by kind, worst first),
// scores it, shows what changed since the last audit, and writes suggested
// fixes to copy. Danets never edits the site.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Gauge,
  History,
  Info,
  Loader2,
  Play,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Severity = "critical" | "warning" | "notice";

interface IssueItem {
  id: string;
  pageUrl: string;
  detail: Record<string, unknown> | null;
  suggestion: string | null;
  suggestedAt: string | null;
}

interface IssueGroup {
  code: string;
  label: string;
  help: string;
  severity: Severity;
  aiFix: boolean;
  count: number;
  items: IssueItem[];
}

interface VitalsRow {
  url: string;
  source: "field" | "lab";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  performance: number | null;
}

interface AuditDetail {
  id: string;
  rootUrl: string;
  trigger: string;
  status: "queued" | "running" | "done" | "failed";
  pageLimit: number;
  pagesCrawled: number;
  score: number | null;
  summary: { critical: number; warning: number; notice: number; notes?: string[] } | null;
  vitals: VitalsRow[] | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  groups: IssueGroup[];
  diff: { previousScore: number | null; previousAt: string | null; newCount: number; fixedCount: number; fixed: { code: string; label: string; pageUrl: string }[] } | null;
}

interface AuditData {
  settings: { auditUrl: string | null; auditMonthly: boolean };
  site: string | null;
  candidates: { url: string; source: string }[];
  pageLimit: number;
  pagespeed: boolean;
  running: boolean;
  nextManualAt: string | null;
  history: { id: string; rootUrl: string; status: string; score: number | null; pagesCrawled: number; trigger: string; createdAt: string; finishedAt: string | null }[];
  audit: AuditDetail | null;
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

const SEVERITY: Record<Severity, { label: string; icon: typeof AlertOctagon; className: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, className: "text-red-600 dark:text-red-400" },
  warning: { label: "Warning", icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  notice: { label: "Notice", icon: Info, className: "text-sky-600 dark:text-sky-400" },
};

const SOURCE_LABEL: Record<string, string> = { search_console: "Search Console", widget: "Chat widget site", platform_site: "Website we built" };

const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "") || u;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

function scoreTone(score: number) {
  if (score >= 90) return { text: "text-emerald-600 dark:text-emerald-400", label: "Good" };
  if (score >= 70) return { text: "text-amber-600 dark:text-amber-400", label: "Needs work" };
  return { text: "text-red-600 dark:text-red-400", label: "Poor" };
}

function detailLine(code: string, d: Record<string, unknown> | null): string | null {
  if (!d) return null;
  const s = (k: string) => (d[k] === undefined || d[k] === null ? "" : String(d[k]));
  switch (code) {
    case "broken_link":
      return `Links to ${s("link")} (${Number(d.status) === 0 ? "no answer" : `error ${s("status")}`})`;
    case "redirect_chain":
      return `Links to ${s("link")}, which redirects ${s("hops")} times`;
    case "page_error":
      return Number(d.status) === 0 ? "The page didn't answer" : `Answers with error ${s("status")}`;
    case "title_too_long":
    case "title_too_short":
    case "meta_description_too_long":
      return `"${s("current")}" (${s("length")} characters)`;
    case "duplicate_title":
    case "duplicate_meta_description":
      return `"${s("current")}", shared by ${s("count")} pages`;
    case "multiple_h1":
      return Array.isArray(d.headings) ? (d.headings as string[]).map((h) => `"${h}"`).join(", ") : null;
    case "missing_alt":
      return `${s("count")} image${Number(d.count) === 1 ? "" : "s"} without alt text`;
    case "mixed_content":
      return `${s("count")} insecure resource${Number(d.count) === 1 ? "" : "s"}, e.g. ${Array.isArray(d.urls) ? (d.urls as string[])[0] : ""}`;
    case "thin_content":
      return `${s("words")} words`;
    case "noindex":
      return `robots: ${s("robots")}`;
    case "slow_lcp":
      return `${(Number(d.value) / 1000).toFixed(1)} s (${d.source === "field" ? "real visitors" : "test run"})`;
    case "slow_inp":
      return `${s("value")} ms (${d.source === "field" ? "real visitors" : "test run"})`;
    case "high_cls":
      return `${Number(d.value).toFixed(2)} (${d.source === "field" ? "real visitors" : "test run"})`;
    default:
      return null;
  }
}

export function SeoAuditView() {
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async (auditId?: string | null) => {
    try {
      const q = auditId ? `?auditId=${encodeURIComponent(auditId)}` : "";
      setData(await api<AuditData>(`/api/seo/audit${q}`));
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't load the audit.");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(viewing), 0);
    return () => clearTimeout(t);
  }, [load, viewing]);

  // Poll while an audit is running.
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => load(viewing), 4000);
    return () => clearInterval(t);
  }, [data?.running, load, viewing]);

  const run = async () => {
    setStarting(true);
    try {
      setViewing(null);
      setData(await api<AuditData>("/api/seo/audit", { method: "POST" }));
      toast.success("Audit started. This page updates as it runs.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the audit.");
    } finally {
      setStarting(false);
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  const audit = data.audit;
  const tooSoon = data.nextManualAt && new Date(data.nextManualAt) > new Date();
  const isLatest = !viewing || viewing === data.history[0]?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Site audit</h1>
          <p className="text-sm text-muted-foreground">
            {data.site ? (
              <>
                Checks <span className="font-medium text-foreground">{shortUrl(data.site)}</span> for problems that hurt it in Google, up to {data.pageLimit > 0 ? data.pageLimit.toLocaleString() : "5,000"} pages.
              </>
            ) : (
              "Checks your website for problems that hurt it in Google."
            )}
          </p>
        </div>
        {data.canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Settings
            </Button>
            {data.site && (
              <Button size="sm" onClick={run} disabled={starting || data.running || !!tooSoon} title={tooSoon ? `You can run the next audit at ${when(data.nextManualAt)}` : undefined}>
                {starting || data.running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {data.running ? "Audit running" : "Run audit"}
              </Button>
            )}
          </div>
        )}
      </div>

      {showSettings && data.canEdit && <SettingsCard data={data} onSaved={(d) => (setData(d), setShowSettings(false))} />}

      {!data.site ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No website to audit yet</p>
            <p className="mx-auto mt-1 max-w-md">
              Connect your Search Console property (Setup tab), add your website to the chat widget&apos;s allowed sites, or ask us to build your site. To keep crawling safe, Danets only audits sites linked to your account.
            </p>
          </CardContent>
        </Card>
      ) : !audit ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No audit yet</p>
            <p className="mt-1">{data.canEdit ? "Run your first audit to see what to fix." : "Ask an admin to run the first audit."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {!isLatest && (
            <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span>Viewing the audit from {when(audit.createdAt)}.</span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setViewing(null)}>
                Back to latest
              </Button>
            </div>
          )}
          <AuditBody audit={audit} canEdit={data.canEdit} onIssue={(groupCode, item) => setData((prev) => (prev && prev.audit ? { ...prev, audit: replaceItem(prev.audit, groupCode, item) } : prev))} />
        </>
      )}

      {data.history.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Past audits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.history.map((h) => (
              <button
                key={h.id}
                onClick={() => setViewing(h.id)}
                className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", audit?.id === h.id && "bg-muted")}
              >
                <span className="truncate">
                  {when(h.createdAt)} · {shortUrl(h.rootUrl)}
                  {h.trigger === "schedule" && <span className="text-muted-foreground"> · monthly</span>}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {h.status === "done" ? `${h.score}/100 · ${h.pagesCrawled} pages` : h.status === "failed" ? "Failed" : "Running"}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function replaceItem(audit: AuditDetail, code: string, item: IssueItem): AuditDetail {
  return { ...audit, groups: audit.groups.map((g) => (g.code === code ? { ...g, items: g.items.map((i) => (i.id === item.id ? item : i)) } : g)) };
}

function SettingsCard({ data, onSaved }: { data: AuditData; onSaved: (d: AuditData) => void }) {
  const [url, setUrl] = useState(data.settings.auditUrl ?? "");
  const [monthly, setMonthly] = useState(data.settings.auditMonthly);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const d = await api<AuditData>("/api/seo/audit/settings", { method: "PATCH", json: { auditUrl: url.trim() || null, auditMonthly: monthly } });
      toast.success("Audit settings saved.");
      onSaved(d);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Audit settings</CardTitle>
        <CardDescription>Danets only audits websites linked to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="audit-url">Website to audit</Label>
          <Input id="audit-url" placeholder={data.candidates[0]?.url ?? "https://example.com"} value={url} onChange={(e) => setUrl(e.target.value)} />
          {data.candidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {data.candidates.map((c) => (
                <button key={c.url} type="button" onClick={() => setUrl(c.url)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
                  {shortUrl(c.url)} <span className="text-muted-foreground">· {SOURCE_LABEL[c.source] ?? c.source}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Leave empty to use the first site listed.</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="audit-monthly">Re-audit every month</Label>
            <p className="text-xs text-muted-foreground">Runs automatically 30 days after the last audit.</p>
          </div>
          <Switch id="audit-monthly" checked={monthly} onCheckedChange={setMonthly} />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditBody({ audit, canEdit, onIssue }: { audit: AuditDetail; canEdit: boolean; onIssue: (code: string, item: IssueItem) => void }) {
  if (audit.status === "queued" || audit.status === "running") {
    const pct = audit.pageLimit > 0 ? Math.min(100, Math.round((audit.pagesCrawled / audit.pageLimit) * 100)) : 0;
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {audit.status === "queued" ? "Waiting to start…" : `Checking ${shortUrl(audit.rootUrl)}: ${audit.pagesCrawled} page${audit.pagesCrawled === 1 ? "" : "s"} so far`}
          </div>
          <Progress value={pct} aria-label="Pages checked" />
          <p className="text-xs text-muted-foreground">The crawler reads one page at a time and follows your robots.txt, so a large site can take a while. You can leave this page.</p>
        </CardContent>
      </Card>
    );
  }
  if (audit.status === "failed") {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-6 text-sm">
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">The audit of {shortUrl(audit.rootUrl)} couldn&apos;t finish</p>
            <p className="text-muted-foreground">{audit.error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const score = audit.score ?? 0;
  const tone = scoreTone(score);
  const s = audit.summary ?? { critical: 0, warning: 0, notice: 0 };
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Gauge className="h-4 w-4" /> Score
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <span className={cn("text-sm font-medium", tone.text)}>{tone.label}</span>
            </div>
            {audit.diff?.previousScore != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {score === audit.diff.previousScore ? "Same as" : score > audit.diff.previousScore ? `Up ${score - audit.diff.previousScore} from` : `Down ${audit.diff.previousScore - score} from`} last time ({audit.diff.previousScore})
              </p>
            )}
          </CardContent>
        </Card>
        {(["critical", "warning", "notice"] as const).map((sev) => {
          const Icon = SEVERITY[sev].icon;
          return (
            <Card key={sev}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className={cn("h-4 w-4", SEVERITY[sev].className)} /> {SEVERITY[sev].label}
                </div>
                <div className="mt-1 text-3xl font-bold tabular-nums">{s[sev]}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {audit.pagesCrawled} page{audit.pagesCrawled === 1 ? "" : "s"} checked on {shortUrl(audit.rootUrl)}, finished {when(audit.finishedAt)}
        {audit.requestedBy ? ` · started by ${audit.requestedBy}` : ""}.
      </p>

      {audit.diff && (audit.diff.newCount > 0 || audit.diff.fixedCount > 0) && (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            <p>
              Since the audit on {when(audit.diff.previousAt)}: <span className="font-medium text-emerald-600 dark:text-emerald-400">{audit.diff.fixedCount} fixed</span>,{" "}
              <span className="font-medium">{audit.diff.newCount} new</span>.
            </p>
            {audit.diff.fixed.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {audit.diff.fixed.slice(0, 5).map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5 truncate">
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" /> {f.label} · {shortUrl(f.pageUrl)}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {(audit.summary?.notes ?? []).length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {audit.summary!.notes!.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3 w-3 shrink-0" /> {n}
            </li>
          ))}
        </ul>
      )}

      {audit.groups.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No problems found.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What to fix</CardTitle>
            <CardDescription>Worst first. Open a row to see the pages.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {audit.groups.map((g) => (
              <IssueGroupRow key={g.code} group={g} canEdit={canEdit} onIssue={(item) => onIssue(g.code, item)} />
            ))}
          </CardContent>
        </Card>
      )}

      {audit.vitals && audit.vitals.length > 0 && <VitalsCard vitals={audit.vitals} />}
    </>
  );
}

function IssueGroupRow({ group, canEdit, onIssue }: { group: IssueGroup; canEdit: boolean; onIssue: (item: IssueItem) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = SEVERITY[group.severity].icon;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-muted/50" aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <Icon className={cn("h-4 w-4 shrink-0", SEVERITY[group.severity].className)} aria-label={SEVERITY[group.severity].label} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.label}</span>
        <Badge variant="secondary" className="tabular-nums">
          {group.count}
        </Badge>
      </button>
      {open && (
        <div className="space-y-2 px-6 pb-4 pl-[3.25rem]">
          <p className="text-xs text-muted-foreground">{group.help}</p>
          {group.items.map((item) => (
            <IssueItemRow key={item.id} code={group.code} item={item} aiFix={group.aiFix && canEdit} onIssue={onIssue} />
          ))}
          {group.count > group.items.length && <p className="text-xs text-muted-foreground">And {group.count - group.items.length} more.</p>}
        </div>
      )}
    </div>
  );
}

function IssueItemRow({ code, item, aiFix, onIssue }: { code: string; item: IssueItem; aiFix: boolean; onIssue: (item: IssueItem) => void }) {
  const [busy, setBusy] = useState(false);
  const detail = detailLine(code, item.detail);
  const suggest = async () => {
    setBusy(true);
    try {
      const d = await api<{ issue: IssueItem }>(`/api/seo/audit/issues/${item.id}/suggest`, { method: "POST" });
      onIssue(d.issue);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't write a suggestion.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={item.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate font-medium hover:underline">
            <span className="truncate">{shortUrl(item.pageUrl)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          {detail && <p className="break-words text-xs text-muted-foreground">{detail}</p>}
        </div>
        {aiFix && !item.suggestion && (
          <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={suggest} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Suggest a fix
          </Button>
        )}
      </div>
      {item.suggestion && (
        <div className="mt-2 rounded-md bg-muted/60 p-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium">
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" /> Suggested (copy it into your site)
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => navigator.clipboard.writeText(item.suggestion!).then(() => toast.success("Copied."), () => toast.error("Couldn't copy."))}
              >
                <Copy className="mr-1 h-3 w-3" />
                Copy
              </Button>
              {aiFix && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={suggest} disabled={busy}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Try again"}
                </Button>
              )}
            </div>
          </div>
          <p className="whitespace-pre-wrap break-words text-xs">{item.suggestion}</p>
        </div>
      )}
    </div>
  );
}

const VITAL_GOOD = { lcpMs: 2500, inpMs: 200, cls: 0.1 };
const VITAL_POOR = { lcpMs: 4000, inpMs: 500, cls: 0.25 };

function VitalCell({ metric, value }: { metric: keyof typeof VITAL_GOOD; value: number | null }) {
  if (value === null) return <td className="px-2 py-1.5 text-right text-muted-foreground">-</td>;
  const rating = value <= VITAL_GOOD[metric] ? "Good" : value <= VITAL_POOR[metric] ? "Needs work" : "Poor";
  const shown = metric === "lcpMs" ? `${(value / 1000).toFixed(1)} s` : metric === "inpMs" ? `${Math.round(value)} ms` : value.toFixed(2);
  const Icon = rating === "Good" ? CheckCircle2 : rating === "Poor" ? AlertOctagon : AlertTriangle;
  const cls = rating === "Good" ? "text-emerald-600 dark:text-emerald-400" : rating === "Poor" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      <span className="inline-flex items-center gap-1" title={rating}>
        {shown} <Icon className={cn("h-3 w-3", cls)} aria-label={rating} />
      </span>
    </td>
  );
}

function VitalsCard({ vitals }: { vitals: VitalsRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Page speed (Core Web Vitals, mobile)</CardTitle>
        <CardDescription>Real-visitor data from Google where there&apos;s enough traffic, otherwise a test run.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">Page</th>
              <th className="px-2 py-1 text-right font-medium">Main content (LCP)</th>
              <th className="px-2 py-1 text-right font-medium">Response (INP)</th>
              <th className="px-2 py-1 text-right font-medium">Layout shift (CLS)</th>
              <th className="px-2 py-1 text-right font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {vitals.map((v) => (
              <tr key={v.url} className="border-t">
                <td className="max-w-[14rem] truncate px-2 py-1.5">{shortUrl(v.url)}</td>
                <VitalCell metric="lcpMs" value={v.lcpMs} />
                <VitalCell metric="inpMs" value={v.inpMs} />
                <VitalCell metric="cls" value={v.cls} />
                <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">{v.source === "field" ? "Visitors" : "Test"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
