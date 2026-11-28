"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, Layers, Loader2, Plus, PlugZap, RotateCcw, Save, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Task = "chat" | "classify" | "extract" | "content" | "plan";
type Provider = "anthropic" | "openai" | "alibaba";
type Plan = "free" | "starter" | "pro" | "enterprise";

interface ProviderView {
  provider: Provider;
  label: string;
  keySource: "stored" | "env" | null;
  keyMasked: string;
  keyUnreadable: boolean;
  usable: boolean;
  baseUrl: string;
  region: string | null;
  workspaceId: string | null;
  endpoint: string | null;
}

interface ModelRow {
  provider: Provider;
  model: string;
  label: string;
  enabled: boolean;
  minPlan: Plan;
  key?: string;
  hasKey?: boolean;
  tenants?: number;
}

interface AiView {
  providers: ProviderView[];
  models: (ModelRow & { key: string; hasKey: boolean; tenants: number })[];
  defaults: Partial<Record<Task, string>>;
  customised: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  options: {
    plans: Plan[];
    tasks: Task[];
    regions: { id: string; label: string; needsWorkspace: boolean }[];
    builtinTaskModels: Record<"anthropic" | "alibaba", Record<Task, string>>;
  };
}

type TestResult = { ok: true; model: string; reply: string; latencyMs: number } | { ok: false; model?: string; error: string };

const TASK_LABEL: Record<Task, { name: string; hint: string }> = {
  chat: { name: "Chat", hint: "Chatbot and assistant replies" },
  classify: { name: "Quick jobs", hint: "Scoring and yes/no checks. Tenants can't change this one." },
  extract: { name: "Extract", hint: "Structured data: briefs, reports, lead details" },
  content: { name: "Content", hint: "Posts, emails and page copy" },
  plan: { name: "Plan", hint: "Longer reasoning: strategies and plans" },
};

const PLAN_LABEL: Record<Plan, string> = { free: "Free", starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
const PROVIDER_SHORT: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI", alibaba: "Alibaba" };
const KEY_PLACEHOLDER: Record<Provider, string> = { anthropic: "sk-ant-…", openai: "sk-…", alibaba: "sk-…" };
const AUTO = "__auto__";

async function put(body: unknown) {
  const res = await fetch("/api/super-admin/platform-config/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Save failed");
  return d.ai as AiView;
}

// ─── One provider's key ──────────────────────────────────────────────

function ProviderCard({ p, regions, onSaved }: { p: ProviderView; regions: AiView["options"]["regions"]; onSaved: (v: AiView) => void }) {
  const [form, setForm] = React.useState({ apiKey: "", baseUrl: p.baseUrl, region: p.region ?? "singapore", workspaceId: p.workspaceId ?? "", model: "" });
  const [busy, setBusy] = React.useState<null | "save" | "test" | "remove">(null);
  const [test, setTest] = React.useState<TestResult | null>(null);
  const [confirm, setConfirm] = React.useState(false);

  const body = () => ({
    provider: p.provider,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    baseUrl: form.baseUrl.trim(),
    ...(p.provider === "alibaba" ? { region: form.region, workspaceId: form.workspaceId.trim() } : {}),
  });

  async function save() {
    setBusy("save");
    try {
      onSaved(await put({ section: "provider", ...body() }));
      setForm((f) => ({ ...f, apiKey: "" }));
      toast.success(`${p.label} key saved`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      const res = await fetch("/api/super-admin/platform-config/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body(), ...(form.model.trim() ? { model: form.model.trim() } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 400) throw new Error(d.error || "Check the form");
      setTest(d as TestResult);
    } catch (e: unknown) {
      setTest({ ok: false, error: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      const res = await fetch(`/api/super-admin/platform-config/ai?provider=${p.provider}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Remove failed");
      onSaved(d.ai);
      setTest(null);
      toast.success(`${p.label} key removed`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  const region = regions.find((r) => r.id === form.region);
  const badge =
    p.keySource === "stored" ? <Badge>Key saved</Badge> : p.keySource === "env" ? <Badge variant="secondary">Key from server env</Badge> : <Badge variant="outline">No key</Badge>;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{p.label}</p>
        {badge}
      </div>

      {p.provider === "alibaba" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Region</Label>
            <Select value={form.region} onValueChange={(v) => setForm((f) => ({ ...f, region: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">The region the key was created in.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-ws" className="text-xs">
              Workspace ID {region?.needsWorkspace && !form.baseUrl.trim() ? <span className="text-destructive">(required)</span> : <span className="text-muted-foreground">(recommended)</span>}
            </Label>
            <Input id="ai-ws" value={form.workspaceId} onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))} placeholder="e.g. ws-abc123" autoComplete="off" />
            <p className="text-xs text-muted-foreground">Gives the faster workspace endpoint.</p>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`ai-key-${p.provider}`} className="text-xs">
          API key
        </Label>
        <Input
          id={`ai-key-${p.provider}`}
          type="password"
          autoComplete="new-password"
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          placeholder={p.keySource === "stored" ? `Saved: ${p.keyMasked}. Leave blank to keep it.` : p.keySource === "env" ? "Using the server's env key. Enter one to override it." : KEY_PLACEHOLDER[p.provider]}
        />
        {p.keyUnreadable ? <p className="text-xs text-destructive">The saved key can&apos;t be read (the server&apos;s encryption key changed). Enter it again.</p> : null}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Advanced</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`ai-base-${p.provider}`} className="text-xs">
              Base URL
            </Label>
            <Input id={`ai-base-${p.provider}`} value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="Default" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ai-tm-${p.provider}`} className="text-xs">
              Model to test with
            </Label>
            <Input id={`ai-tm-${p.provider}`} value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder={p.provider === "openai" ? "First OpenAI model in the list" : "The fast model"} className="font-mono text-xs" />
          </div>
        </div>
        {p.endpoint ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Endpoint: <span className="font-mono break-all">{p.endpoint}</span>
          </p>
        ) : null}
      </details>

      {test ? (
        <div className={`flex items-start gap-2 rounded-md border p-2.5 text-sm ${test.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
          {test.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <p className="min-w-0 break-words">{test.ok ? `Connected. ${test.model} replied "${test.reply || "(empty)"}" in ${(test.latencyMs / 1000).toFixed(1)}s.` : test.error}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {p.keySource === "stored" || p.keyUnreadable ? (
          <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirm(true)} disabled={!!busy}>
            <Trash2 className="h-4 w-4" /> Remove key
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={runTest} disabled={!!busy || (!p.usable && !form.apiKey.trim())}>
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Test
        </Button>
        <Button size="sm" className="gap-1.5" onClick={save} disabled={!!busy}>
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {p.label} key?</AlertDialogTitle>
            <AlertDialogDescription>
              Its models stop being offered to tenants{p.keySource === "env" ? "" : " unless the server env has a key"}. Tenants using them move to the platform default within a minute.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────

export function PlatformAiPanel() {
  const [view, setView] = React.useState<AiView | null>(null);
  const [rows, setRows] = React.useState<ModelRow[]>([]);
  const [defaults, setDefaults] = React.useState<Partial<Record<Task, string>>>({});
  const [adding, setAdding] = React.useState({ provider: "openai" as Provider, model: "", label: "" });
  const [saving, setSaving] = React.useState(false);

  const apply = React.useCallback((v: AiView) => {
    setView(v);
    setRows(v.models.map(({ provider, model, label, enabled, minPlan }) => ({ provider, model, label, enabled, minPlan })));
    setDefaults(v.defaults);
  }, []);

  React.useEffect(() => {
    fetch("/api/super-admin/platform-config/ai", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d) => apply(d.ai))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to load AI settings"));
  }, [apply]);

  if (!view) {
    return (
      <Card>
        <CardContent className="py-12">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const keyed = new Set(view.providers.filter((p) => p.usable).map((p) => p.provider));
  const tenantsOn = new Map(view.models.map((m) => [m.key, m.tenants]));
  const rowKey = (r: ModelRow) => `${r.provider}:${r.model}`;
  const update = (i: number, patch: Partial<ModelRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function addModel() {
    const model = adding.model.trim();
    if (!model) return;
    if (rows.some((r) => r.provider === adding.provider && r.model === model)) {
      toast.error("That model is already in the list");
      return;
    }
    setRows((rs) => [...rs, { provider: adding.provider, model, label: adding.label.trim() || model, enabled: true, minPlan: "free" }]);
    setAdding((a) => ({ ...a, model: "", label: "" }));
  }

  async function saveModels() {
    setSaving(true);
    try {
      const clean = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v && rows.some((r) => rowKey(r) === v)));
      apply(await put({ section: "models", models: rows, defaults: clean }));
      toast.success("Models saved. Tenants see the changes within a minute.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      apply(await put({ section: "reset-models" }));
      toast.success("Model list reset to the built-in models");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  const autoLabel = (t: Task) => {
    const first = (["anthropic", "alibaba", "openai"] as Provider[]).find((p) => keyed.has(p));
    if (!first) return "Automatic (built-in model)";
    const m = first === "openai" ? rows.find((r) => r.provider === "openai" && r.enabled)?.model : view.options.builtinTaskModels[first][t];
    return `Automatic${m ? ` (${m})` : ""}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> AI provider keys
          </CardTitle>
          <CardDescription>
            The platform holds every AI key. Tenants can&apos;t add their own; they pick from the models below. Keys are stored encrypted and never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.providers.map((p) => (
            <ProviderCard key={`${p.provider}:${p.keySource}:${p.keyMasked}:${p.region}:${p.workspaceId}:${p.baseUrl}`} p={p} regions={view.options.regions} onSaved={apply} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Models tenants can choose
          </CardTitle>
          <CardDescription>Each tenant picks one model for all its AI features, from the enabled models its plan allows. Models whose provider has no key are hidden from tenants.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-[42%] px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-left font-medium">Provider</th>
                  <th className="px-3 py-2 text-left font-medium">Lowest plan</th>
                  <th className="px-3 py-2 text-left font-medium">Tenants</th>
                  <th className="px-3 py-2 text-left font-medium">On</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={rowKey(r)} className="border-t">
                    <td className="px-3 py-2">
                      <Input value={r.label} onChange={(e) => update(i, { label: e.target.value })} className="h-8" aria-label={`Name for ${r.model}`} />
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{r.model}</p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="block pt-1.5">{PROVIDER_SHORT[r.provider]}</span>
                      {!keyed.has(r.provider) ? <Badge variant="outline" className="mt-1 text-[10px]">No key</Badge> : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Select value={r.minPlan} onValueChange={(v) => update(i, { minPlan: v as Plan })}>
                        <SelectTrigger className="h-8 w-[120px]" aria-label={`Lowest plan for ${r.model}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {view.options.plans.map((p) => (
                            <SelectItem key={p} value={p}>
                              {PLAN_LABEL[p]}
                              {p === "enterprise" ? "" : "+"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="block pt-1.5 tabular-nums">{tenantsOn.get(rowKey(r)) ?? 0}</span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Switch className="mt-1" checked={r.enabled} onCheckedChange={(v) => update(i, { enabled: v })} aria-label={`Offer ${r.model}`} />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.model}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      No models. Add one below or reset to the built-in list.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[140px_1fr_1fr_auto]">
            <Select value={adding.provider} onValueChange={(v) => setAdding((a) => ({ ...a, provider: v as Provider }))}>
              <SelectTrigger aria-label="Provider of the new model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["openai", "anthropic", "alibaba"] as Provider[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_SHORT[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={adding.model} onChange={(e) => setAdding((a) => ({ ...a, model: e.target.value }))} placeholder="Model id, e.g. gpt-5.5" className="font-mono text-xs" aria-label="Model id" />
            <Input value={adding.label} onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} placeholder="Name tenants see (optional)" aria-label="Model name" onKeyDown={(e) => e.key === "Enter" && addModel()} />
            <Button variant="outline" className="gap-1.5" onClick={addModel} disabled={!adding.model.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">Platform defaults</p>
              <p className="text-xs text-muted-foreground">Used by tenants who haven&apos;t picked a model. &ldquo;Quick jobs&rdquo; always uses this, whatever the tenant picks.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {view.options.tasks.map((t) => (
                <div key={t} className="space-y-1">
                  <Label className="text-xs">
                    {TASK_LABEL[t].name} <span className="font-normal text-muted-foreground">· {TASK_LABEL[t].hint}</span>
                  </Label>
                  <Select value={defaults[t] ?? AUTO} onValueChange={(v) => setDefaults((d) => ({ ...d, [t]: v === AUTO ? undefined : v }))}>
                    <SelectTrigger aria-label={`Default model for ${TASK_LABEL[t].name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>{autoLabel(t)}</SelectItem>
                      {rows
                        .filter((r) => keyed.has(r.provider))
                        .map((r) => (
                          <SelectItem key={rowKey(r)} value={rowKey(r)}>
                            {r.label} ({PROVIDER_SHORT[r.provider]})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {view.updatedBy && view.updatedAt ? `Last saved by ${view.updatedBy}, ${new Date(view.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Built-in model list"}
            </p>
            <div className="flex flex-wrap gap-2">
              {view.customised ? (
                <Button variant="ghost" className="gap-1.5" onClick={reset} disabled={saving}>
                  <RotateCcw className="h-4 w-4" /> Reset list
                </Button>
              ) : null}
              <Button className="gap-1.5" onClick={saveModels} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save models
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
