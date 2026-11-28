"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PlugZap, Save, Sparkles, Trash2, XCircle } from "lucide-react";
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

interface AiView {
  configured: boolean;
  enabled: boolean;
  region: string;
  workspaceId: string;
  baseUrl: string;
  endpoint: string | null;
  models: Partial<Record<Task, string>>;
  hasKey: boolean;
  keyMasked: string;
  keyUnreadable: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  options: {
    regions: { id: string; label: string; needsWorkspace: boolean }[];
    models: readonly { id: string; label: string }[];
    taskDefaults: Record<Task, string>;
    tasks: Task[];
  };
  envDefault: string;
}

type TestResult = { ok: true; model: string; reply: string; latencyMs: number; endpoint: string } | { ok: false; model?: string; error: string; endpoint?: string };

const TASK_LABEL: Record<Task, { name: string; hint: string }> = {
  chat: { name: "Chat", hint: "Website chatbot and assistant replies" },
  classify: { name: "Classify", hint: "Quick yes/no and scoring jobs" },
  extract: { name: "Extract", hint: "Structured data: briefs, reports, lead details" },
  content: { name: "Content", hint: "Posts, emails and page copy" },
  plan: { name: "Plan", hint: "Longer reasoning: strategies and plans" },
};

const ENV_LABEL: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  alibaba: "Alibaba Cloud from env",
  zai: "the built-in z-ai model",
};

export function PlatformAiPanel() {
  const [view, setView] = React.useState<AiView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [test, setTest] = React.useState<TestResult | null>(null);
  const [form, setForm] = React.useState({
    enabled: false,
    region: "singapore",
    workspaceId: "",
    baseUrl: "",
    apiKey: "",
    models: {} as Partial<Record<Task, string>>,
  });

  const apply = React.useCallback((v: AiView) => {
    setView(v);
    setForm({ enabled: v.enabled, region: v.region, workspaceId: v.workspaceId, baseUrl: v.baseUrl, apiKey: "", models: v.models });
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/super-admin/platform-config/ai", { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        apply((await res.json()).ai);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Failed to load AI settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [apply]);

  const payload = (enabled = form.enabled) => ({
    enabled,
    provider: "alibaba",
    region: form.region,
    workspaceId: form.workspaceId.trim(),
    baseUrl: form.baseUrl.trim(),
    models: form.models,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/platform-config/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Save failed");
      apply(d.ai);
      toast.success(d.ai.enabled ? "Alibaba Cloud now serves AI features" : "AI settings saved (off)");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/super-admin/platform-config/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 400) throw new Error(d.error || "Check the form");
      setTest(d as TestResult);
    } catch (e: unknown) {
      setTest({ ok: false, error: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      const res = await fetch("/api/super-admin/platform-config/ai", { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Remove failed");
      apply(d.ai);
      setTest(null);
      toast.success("Alibaba Cloud settings removed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  if (loading || !view) {
    return (
      <Card>
        <CardContent className="py-12">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const region = view.options.regions.find((r) => r.id === form.region);
  const needsWorkspace = !!region?.needsWorkspace && !form.baseUrl.trim();
  const fallback = ENV_LABEL[view.envDefault] ?? view.envDefault;
  const active = view.enabled && view.hasKey;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Alibaba Cloud (Qwen)
              </CardTitle>
              <CardDescription>
                Alibaba Cloud Model Studio serves the AI features of every tenant that hasn&apos;t added its own AI key. When it&apos;s off, AI uses {fallback}.
              </CardDescription>
            </div>
            <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : view.configured ? "Off" : "Not set up"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="ai-enabled" className="text-sm font-medium">
                Use Alibaba Cloud for AI features
              </Label>
              <p className="text-xs text-muted-foreground">Takes effect within a minute of saving.</p>
            </div>
            <Switch id="ai-enabled" checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={form.region} onValueChange={(v) => setForm((f) => ({ ...f, region: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.options.regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Use the region the API key was created in. Keys only work in their own region.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-ws">
                Workspace ID {needsWorkspace ? <span className="text-destructive">(required)</span> : <span className="text-muted-foreground">(recommended)</span>}
              </Label>
              <Input id="ai-ws" value={form.workspaceId} onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))} placeholder="e.g. ws-abc123" autoComplete="off" />
              <p className="text-xs text-muted-foreground">Gives the faster workspace endpoint. Find it in the Model Studio console.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ai-key">API key</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={view.hasKey ? `Saved: ${view.keyMasked}. Leave blank to keep it.` : "sk-…"}
            />
            {view.keyUnreadable ? (
              <p className="text-xs text-destructive">The saved key can&apos;t be read (the server&apos;s encryption key changed). Enter it again.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Stored encrypted. It&apos;s never shown again or sent to the browser.</p>
            )}
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">Models</p>
              <p className="text-xs text-muted-foreground">Leave a task blank to use the recommended model shown.</p>
            </div>
            <datalist id="qwen-models">
              {view.options.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
            <div className="grid gap-3 sm:grid-cols-2">
              {view.options.tasks.map((t) => (
                <div key={t} className="space-y-1">
                  <Label htmlFor={`ai-model-${t}`} className="text-xs">
                    {TASK_LABEL[t].name} <span className="font-normal text-muted-foreground">· {TASK_LABEL[t].hint}</span>
                  </Label>
                  <Input
                    id={`ai-model-${t}`}
                    list="qwen-models"
                    value={form.models[t] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, models: { ...f.models, [t]: e.target.value } }))}
                    placeholder={view.options.taskDefaults[t]}
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Advanced: custom endpoint</summary>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="ai-base">Base URL</Label>
              <Input id="ai-base" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://….aliyuncs.com/compatible-mode/v1" className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">Overrides the region and workspace. Must be an https address on aliyuncs.com.</p>
            </div>
          </details>

          {view.configured && view.endpoint ? (
            <p className="text-xs text-muted-foreground">
              Saved endpoint: <span className="font-mono break-all">{view.endpoint}</span>
            </p>
          ) : null}

          {test ? (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${test.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {test.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="min-w-0">
                {test.ok ? (
                  <p>
                    Connected. {test.model} replied &ldquo;{test.reply || "(empty)"}&rdquo; in {(test.latencyMs / 1000).toFixed(1)}s.
                  </p>
                ) : (
                  <p className="break-words">{test.error}</p>
                )}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {view.updatedBy && view.updatedAt ? `Last saved by ${view.updatedBy}, ${new Date(view.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {view.configured ? (
                <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)} disabled={removing}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              ) : null}
              <Button variant="outline" className="gap-1.5" onClick={runTest} disabled={testing || (!view.hasKey && !form.apiKey.trim())}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Test connection
              </Button>
              <Button className="gap-1.5" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Alibaba Cloud?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the saved API key and settings. AI features switch to {fallback} within a minute. Tenants with their own AI key aren&apos;t affected.
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
