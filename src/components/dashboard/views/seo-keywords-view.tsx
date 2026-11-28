"use client";

// SEO (Phase 3, workstream Y). Tracked keywords from Search Console, the
// weekly content opportunities (almost page one, low click-through,
// cannibalisation) and AI content briefs written from the knowledge base.
// Danets never edits the site: briefs and suggestions are for the tenant to use.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Download, ExternalLink, EyeOff, FileText, Loader2, Plus, RefreshCw, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

interface Property {
  id: string;
  siteUrl: string;
  status: string;
  syncedThrough: string | null;
  opportunitiesAt: string | null;
  opportunitiesError: string | null;
}

interface Keyword {
  id: string;
  keyword: string;
  targetUrl: string | null;
  rankingPage: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  previousPosition: number | null;
  change: number | null;
  weekly: (number | null)[];
}

interface KeywordsData {
  properties: Property[];
  propertyId: string | null;
  limit: { used: number; limit: number };
  to: string | null;
  keywords: Keyword[];
  suggestions: { keyword: string; clicks: number; impressions: number; position: number }[];
  canEdit: boolean;
}

type Kind = "almost_page_one" | "low_ctr" | "cannibalisation";

interface Opportunity {
  id: string;
  kind: Kind;
  query: string;
  page: string | null;
  pages: { url: string; clicks: number; impressions: number; position: number }[] | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  expectedCtr: number | null;
  potentialClicks: number;
  suggestion: string | null;
  dismissed: boolean;
}

interface OpportunitiesData {
  propertyId: string | null;
  computedAt: string | null;
  error: string | null;
  hasData?: boolean;
  counts: Record<Kind, number> | null;
  dismissedCount?: number;
  opportunities: Opportunity[];
  scanning: boolean;
  canEdit: boolean;
}

interface BriefSummary {
  id: string;
  query: string;
  title: string;
  gaps: number;
  createdByName: string | null;
  createdAt: string;
}

interface BriefFull extends BriefSummary {
  markdown: string;
  brief: { intentType: string; wordCount: number; facts: { fact: string; source: string }[]; gaps: string[] };
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

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || u;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString();
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Copied."), () => toast.error("Couldn't copy."));

const KIND: Record<Kind, { label: string; help: string }> = {
  almost_page_one: { label: "Almost page one", help: "Searches where you show at positions 8–20. A better page could reach page one." },
  low_ctr: { label: "Low click-through", help: "You're in the top 5 but far fewer people click than usual. A better title and description usually fix it." },
  cannibalisation: { label: "Pages competing", help: "Several of your pages show for the same search, splitting Google's attention. Pick one to be the main page." },
};

// ─── View ────────────────────────────────────────────────────────────

export function SeoKeywordsView() {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [kw, setKw] = useState<KeywordsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<BriefSummary[] | null>(null);
  const [openBrief, setOpenBrief] = useState<string | null>(null);

  const loadKeywords = useCallback(async () => {
    try {
      const d = await api<KeywordsData>(`/api/seo/keywords${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`);
      setKw(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [propertyId]);
  const loadBriefs = useCallback(async () => {
    try {
      setBriefs((await api<{ briefs: BriefSummary[] }>("/api/seo/briefs")).briefs);
    } catch {
      setBriefs([]);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      loadKeywords();
      loadBriefs();
    }, 0);
    return () => clearTimeout(t);
  }, [loadKeywords, loadBriefs]);

  const onBrief = (b: { id: string }) => {
    loadBriefs();
    setOpenBrief(b.id);
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!kw) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Keywords &amp; content</h1>
          <p className="text-sm text-muted-foreground">The searches that matter to you, where you could win more clicks, and briefs for the pages to write.</p>
        </div>
        {kw.properties.length > 1 && (
          <Select value={kw.propertyId ?? ""} onValueChange={(v) => setPropertyId(v)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kw.properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {shortUrl(p.siteUrl)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!kw.propertyId ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Add a Search Console property on the Setup tab to track keywords.</CardContent>
        </Card>
      ) : (
        <>
          <KeywordsCard data={kw} onChange={loadKeywords} onBrief={onBrief} />
          <OpportunitiesCard propertyId={kw.propertyId} onBrief={onBrief} />
        </>
      )}
      <BriefsCard briefs={briefs} propertyId={kw.propertyId} onOpen={setOpenBrief} onCreated={onBrief} />
      {openBrief && <BriefDialog id={openBrief} onClose={() => setOpenBrief(null)} onDeleted={() => { setOpenBrief(null); loadBriefs(); }} />}
    </div>
  );
}

// ─── Brief creation (shared) ─────────────────────────────────────────

function useCreateBrief(onCreated: (b: { id: string }) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (key: string, body: { opportunityId: string } | { query: string; propertyId?: string }) => {
    setBusy(key);
    try {
      const r = await api<{ brief: { id: string }; warnings: string[] }>("/api/seo/briefs", { method: "POST", json: body });
      toast.success("Brief written.");
      for (const w of r.warnings) toast.warning(w);
      onCreated(r.brief);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, create };
}

// ─── Tracked keywords ────────────────────────────────────────────────

function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const w = 84;
  const h = 24;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min;
  const x = (i: number) => 2 + (i / Math.max(values.length - 1, 1)) * (w - 4);
  // Position 1 is best, so smaller numbers sit higher. A steady position sits in the middle.
  const y = (v: number) => (span < 0.05 ? h / 2 : 2 + ((v - min) / Math.max(span, 1)) * (h - 4));
  const d = pts.map((p, j) => `${j ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-primary" role="img" aria-label={`Weekly average position: ${pts.map((p) => p.v.toFixed(1)).join(", ")}`}>
      <title>{`Weekly average position, last ${values.length} weeks: ${values.map((v) => (v == null ? "none" : v.toFixed(1))).join(", ")}`}</title>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill="currentColor" />
    </svg>
  );
}

function Change({ change }: { change: number | null }) {
  if (change == null || Math.abs(change) < 0.1) return <span className="text-xs text-muted-foreground">—</span>;
  const up = change > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(change).toFixed(1)}
      <span className="sr-only">{up ? "places up" : "places down"}</span>
    </span>
  );
}

function KeywordsCard({ data, onChange, onBrief }: { data: KeywordsData; onChange: () => void; onBrief: (b: { id: string }) => void }) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const { busy, create } = useCreateBrief(onBrief);
  const { used, limit } = data.limit;
  const full = limit > 0 && used >= limit;

  const add = async (keywords: string | string[]) => {
    setAdding(true);
    try {
      const r = await api<{ added: number; skipped: number; invalid: string[] }>("/api/seo/keywords", { method: "POST", json: { keywords, propertyId: data.propertyId } });
      toast.success(r.added ? `Tracking ${r.added} keyword${r.added === 1 ? "" : "s"}.` : "Already tracked.");
      if (r.invalid.length) toast.warning(`${r.invalid.length} skipped: keywords can be up to 200 characters.`);
      setText("");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdding(false);
    }
  };
  const remove = async (k: Keyword) => {
    try {
      await api(`/api/seo/keywords/${k.id}`, { method: "DELETE" });
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const saveTarget = async (k: Keyword) => {
    try {
      await api(`/api/seo/keywords/${k.id}`, { method: "PATCH", json: { targetUrl: target.trim() || null } });
      setEditing(null);
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Tracked keywords</CardTitle>
            <CardDescription>
              Average Google position over the last 28 days{data.to ? ` to ${when(data.to)}` : ""}, from Search Console.{" "}
              {limit > 0 ? `${used} of ${limit} used.` : `${used} tracked.`}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.canEdit && (
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"emergency plumber leeds\nboiler repair near me"}
              rows={2}
              disabled={full}
              aria-label="Keywords to track, one per line"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => add(text)} disabled={adding || full || !text.trim()}>
                {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Track
              </Button>
              <span className="text-xs text-muted-foreground">{full ? "Your plan's keyword limit is reached. Remove some to add more." : "One per line, or separated by commas."}</span>
            </div>
          </div>
        )}

        {data.keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keywords tracked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Keyword</th>
                  <th className="py-2 pr-3 text-right font-medium">Position</th>
                  <th className="py-2 pr-3 font-medium">Change</th>
                  <th className="py-2 pr-3 font-medium">12 weeks</th>
                  <th className="py-2 pr-3 text-right font-medium">Clicks</th>
                  <th className="py-2 pr-3 text-right font-medium">Impressions</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(data.keywords as Keyword[]).map((k) => {
                  const mismatch = k.targetUrl && k.rankingPage && shortUrl(k.targetUrl) !== shortUrl(k.rankingPage);
                  return (
                    <tr key={k.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{k.keyword}</div>
                        <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                          {k.rankingPage && (
                            <div className="flex items-center gap-1">
                              Ranking:
                              <a href={k.rankingPage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                                {shortUrl(k.rankingPage)} <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                          {editing === k.id ? (
                            <div className="flex items-center gap-1">
                              <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://…" className="h-7 text-xs" />
                              <Button size="sm" variant="secondary" className="h-7" onClick={() => saveTarget(k)}>
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : k.targetUrl ? (
                            <div className={cn(mismatch && "text-amber-600 dark:text-amber-400")}>
                              Target: {shortUrl(k.targetUrl)}
                              {mismatch ? " (a different page ranks)" : ""}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {k.position == null ? <Badge variant="outline">Not ranking yet</Badge> : k.position.toFixed(1)}
                      </td>
                      <td className="py-2 pr-3">
                        <Change change={k.change} />
                      </td>
                      <td className="py-2 pr-3">
                        <Sparkline values={k.weekly} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.clicks)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.impressions)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Write a content brief" onClick={() => create(k.id, { query: k.keyword, propertyId: data.propertyId ?? undefined })} disabled={!!busy}>
                          {busy === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                          <span className="sr-only">Write a content brief</span>
                        </Button>
                        {data.canEdit && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditing(k.id); setTarget(k.targetUrl ?? ""); }}>
                              Target
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" title="Stop tracking" onClick={() => remove(k)}>
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Stop tracking</span>
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data.canEdit && data.suggestions.length > 0 && !full && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Your top searches, not tracked yet</p>
            <div className="flex flex-wrap gap-1.5">
              {data.suggestions.map((s) => (
                <Button key={s.keyword} size="sm" variant="outline" className="h-7 text-xs" onClick={() => add([s.keyword])} disabled={adding} title={`${fmt(s.impressions)} impressions, position ${s.position}`}>
                  <Plus className="mr-1 h-3 w-3" />
                  {s.keyword}
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Positions are Search Console averages. Very small searches may not appear, because Google only shares a site&apos;s top queries each day.</p>
      </CardContent>
    </Card>
  );
}

// ─── Opportunities ───────────────────────────────────────────────────

function OpportunitiesCard({ propertyId, onBrief }: { propertyId: string; onBrief: (b: { id: string }) => void }) {
  const [data, setData] = useState<OpportunitiesData | null>(null);
  const [kind, setKind] = useState<Kind>("almost_page_one");
  const [showDismissed, setShowDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const { busy, create } = useCreateBrief(onBrief);

  const load = useCallback(async () => {
    try {
      setData(await api<OpportunitiesData>(`/api/seo/opportunities?propertyId=${encodeURIComponent(propertyId)}${showDismissed ? "&dismissed=1" : ""}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [propertyId, showDismissed]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api("/api/seo/opportunities/refresh", { method: "POST", json: { propertyId } });
      toast.success("Checking now. The list updates in a minute or two.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefreshing(false);
    }
  };
  const replace = (o: Opportunity) => setData((d) => (d ? { ...d, opportunities: d.opportunities.map((x) => (x.id === o.id ? o : x)) } : d));
  const dismiss = async (o: Opportunity, dismissed: boolean) => {
    try {
      await api(`/api/seo/opportunities/${o.id}`, { method: "PATCH", json: { dismissed } });
      // Reload so the counts and the dismissed toggle stay right.
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const suggest = async (o: Opportunity) => {
    setSuggesting(o.id);
    try {
      replace((await api<{ opportunity: Opportunity }>(`/api/seo/opportunities/${o.id}/suggest`, { method: "POST" })).opportunity);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSuggesting(null);
    }
  };

  const list = data?.opportunities.filter((o) => o.kind === kind) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Content opportunities</CardTitle>
            <CardDescription>
              Checked every Monday from the last 28 days of Search Console.{data?.computedAt ? ` Last checked ${when(data.computedAt)}.` : ""}
            </CardDescription>
          </div>
          {data?.canEdit && data.hasData && (
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Check now
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !data.hasData ? (
          <p className="text-sm text-muted-foreground">Search data is still loading. Opportunities appear once the first Search Console sync has finished.</p>
        ) : !data.computedAt ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Looking for opportunities. This takes a minute or two.
          </p>
        ) : (
          <>
            {data.error && <p className="text-sm text-destructive">{data.error}</p>}
            <div className="flex flex-wrap items-center gap-1">
              {(Object.keys(KIND) as Kind[]).map((k) => (
                <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} className="h-8" onClick={() => setKind(k)}>
                  {KIND[k].label}
                  <Badge variant="outline" className="ml-1.5 h-5 px-1.5 tabular-nums">
                    {data.counts?.[k] ?? 0}
                  </Badge>
                </Button>
              ))}
              {(data.dismissedCount ?? 0) > 0 && (
                <Button size="sm" variant="ghost" className="ml-auto h-8 text-xs" onClick={() => setShowDismissed((s) => !s)}>
                  {showDismissed ? "Hide dismissed" : `Show dismissed (${data.dismissedCount})`}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{KIND[kind].help}</p>
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing here this week.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {list.map((o) => (
                  <li key={o.id} className={cn("space-y-2 p-3", o.dismissed && "opacity-60")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{o.query}</div>
                        <div className="text-xs text-muted-foreground">
                          Position {o.position.toFixed(1)} · {fmt(o.impressions)} impressions · {fmt(o.clicks)} clicks · {pct(o.ctr)} click-through
                          {o.kind === "low_ctr" && o.expectedCtr != null ? ` (usually about ${pct(o.expectedCtr)})` : ""}
                        </div>
                        {o.page && o.kind !== "cannibalisation" && (
                          <a href={o.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:underline">
                            {shortUrl(o.page)} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      {o.potentialClicks > 0 && <Badge variant="secondary">About {fmt(o.potentialClicks)} more clicks a month</Badge>}
                    </div>
                    {o.kind === "cannibalisation" && o.pages && (
                      <ul className="space-y-0.5 text-xs">
                        {o.pages.map((p) => (
                          <li key={p.url} className="flex flex-wrap items-center gap-x-2">
                            <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                              {shortUrl(p.url)} <ExternalLink className="h-3 w-3" />
                            </a>
                            <span className="text-muted-foreground">
                              {o.impressions ? Math.round((p.impressions / o.impressions) * 100) : 0}% of impressions · position {p.position.toFixed(1)} · {fmt(p.clicks)} {p.clicks === 1 ? "click" : "clicks"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {o.suggestion && (
                      <div className="rounded-md bg-muted/60 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium">Suggested titles and descriptions</span>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => copy(o.suggestion!)}>
                            <Copy className="mr-1 h-3 w-3" />
                            Copy
                          </Button>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-xs">{o.suggestion}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {o.kind !== "low_ctr" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => create(o.id, { opportunityId: o.id })} disabled={!!busy}>
                          {busy === o.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileText className="mr-1 h-3 w-3" />}Write a brief
                        </Button>
                      )}
                      {o.kind === "low_ctr" && data.canEdit && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => suggest(o)} disabled={!!suggesting}>
                          {suggesting === o.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                          {o.suggestion ? "Suggest again" : "Suggest a better title"}
                        </Button>
                      )}
                      {data.canEdit && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismiss(o, !o.dismissed)}>
                          {o.dismissed ? <RotateCcw className="mr-1 h-3 w-3" /> : <EyeOff className="mr-1 h-3 w-3" />}
                          {o.dismissed ? "Restore" : "Dismiss"}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Briefs ──────────────────────────────────────────────────────────

function BriefsCard({
  briefs,
  propertyId,
  onOpen,
  onCreated,
}: {
  briefs: BriefSummary[] | null;
  propertyId: string | null;
  onOpen: (id: string) => void;
  onCreated: (b: { id: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const { busy, create } = useCreateBrief((b) => {
    setQuery("");
    onCreated(b);
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content briefs</CardTitle>
        <CardDescription>A plan for a page that answers a search: intent, title, outline, questions and the facts from your knowledge base. Anything missing is marked [Add …].</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) create("new", { query: query.trim(), ...(propertyId ? { propertyId } : {}) });
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A search, e.g. boiler service cost" className="max-w-sm" maxLength={200} aria-label="Search to write a brief for" />
          <Button type="submit" size="sm" disabled={!!busy || !query.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Write a brief
          </Button>
        </form>
        {!briefs ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : briefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No briefs yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {briefs.map((b) => (
              <li key={b.id}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-muted/50" onClick={() => onOpen(b.id)}>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.title}</div>
                    <div className="text-xs text-muted-foreground">
                      For &quot;{b.query}&quot; · {b.createdByName ? `${b.createdByName}, ` : ""}
                      {when(b.createdAt)}
                    </div>
                  </div>
                  {b.gaps > 0 ? <Badge variant="outline">{b.gaps} to add</Badge> : <Badge variant="secondary">Complete</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BriefDialog({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: () => void }) {
  const [b, setB] = useState<BriefFull | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ brief: BriefFull }>(`/api/seo/briefs/${id}`).then(
      (d) => live && setB(d.brief),
      (e) => {
        toast.error(e.message);
        onClose();
      }
    );
    return () => {
      live = false;
    };
  }, [id, onClose]);
  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/seo/briefs/${id}`, { method: "DELETE" });
      toast.success("Brief deleted.");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message);
      setDeleting(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{b?.title ?? "Content brief"}</DialogTitle>
          <DialogDescription>{b ? `For the search "${b.query}". Fill in the [Add …] items before the page is published.` : "Loading…"}</DialogDescription>
        </DialogHeader>
        {!b ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(b.markdown)}>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/seo/briefs/${b.id}?format=md`} download>
                  <Download className="mr-2 h-4 w-4" />
                  Markdown
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/seo/briefs/${b.id}?format=pdf`} download>
                  <Download className="mr-2 h-4 w-4" />
                  PDF
                </a>
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={remove} disabled={deleting}>
                {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{b.brief.intentType}</Badge>
              <Badge variant="outline">about {b.brief.wordCount} words</Badge>
              <Badge variant="outline">{b.brief.facts.length} facts from your knowledge base</Badge>
              {b.gaps > 0 && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">{b.gaps} to add</Badge>}
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-sans text-sm">
              {b.markdown.split(/(\[Add[^\]]*\])/g).map((part, i) =>
                part.startsWith("[Add") ? (
                  <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                    {part}
                  </mark>
                ) : (
                  part
                )
              )}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
