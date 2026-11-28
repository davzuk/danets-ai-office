"use client";

import * as React from "react";
import { toast } from "sonner";
import { Cpu, Loader2, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Option {
  key: string;
  label: string;
  model: string;
  providerLabel: string;
  minPlanLabel: string;
  allowed: boolean;
}

export interface AiModelView {
  plan: string;
  planLabel: string;
  selected: string | null;
  selectedUnavailable: boolean;
  options: Option[];
  effective: { provider: string; model: string; label: string };
  canEdit?: boolean;
}

const DEFAULT = "__default__";

/**
 * Pick one AI model from the platform's list. Used by the tenant's Settings
 * (endpoint /api/ai/model) and the platform console (its tenant route).
 */
export function AiModelPicker({ endpoint, canEdit, compact }: { endpoint: string; canEdit: boolean; compact?: boolean }) {
  const [view, setView] = React.useState<AiModelView | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(endpoint, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d) => setView((d.ai ?? d) as AiModelView))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to load AI models"));
  }, [endpoint]);

  async function choose(key: string | null) {
    setSaving(key ?? DEFAULT);
    try {
      const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: key }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't change the model");
      const next = (d.ai ?? d) as AiModelView;
      setView(next);
      toast.success(`AI now uses ${next.effective.label}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the model");
    } finally {
      setSaving(null);
    }
  }

  if (!view) return <Skeleton className="h-40 w-full" />;

  const current = view.selected && !view.selectedUnavailable ? view.selected : null;
  const rows: { key: string | null; title: string; sub: string; allowed: boolean; planLabel?: string }[] = [
    { key: null, title: "Platform default", sub: !current ? `Currently ${view.effective.label}` : "Let the platform choose", allowed: true },
    ...view.options.map((o) => ({ key: o.key, title: o.label, sub: `${o.providerLabel} · ${o.model}`, allowed: o.allowed, planLabel: o.minPlanLabel })),
  ];

  return (
    <div className="space-y-3">
      {view.selectedUnavailable ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          The model picked before isn&apos;t available on the {view.planLabel} plan any more, so the platform default is used.
        </p>
      ) : null}
      <div role="radiogroup" aria-label="AI model" className={cn("grid gap-2", !compact && "sm:grid-cols-2")}>
        {rows.map((r) => {
          const active = (r.key ?? null) === current;
          const disabled = !canEdit || !r.allowed || !!saving;
          return (
            <button
              key={r.key ?? DEFAULT}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => !active && !disabled && choose(r.key)}
              className={cn(
                "flex items-start justify-between gap-2 rounded-lg border p-3 text-left transition-colors",
                active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                !r.allowed && "opacity-60",
                disabled && !active && "cursor-not-allowed"
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
              </span>
              {saving === (r.key ?? DEFAULT) ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : !r.allowed ? (
                <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                  <Lock className="h-3 w-3" /> {r.planLabel}
                </Badge>
              ) : active ? (
                <Badge className="shrink-0 text-[10px]">In use</Badge>
              ) : null}
            </button>
          );
        })}
      </div>
      {view.options.length === 0 ? <p className="text-xs text-muted-foreground">No models are offered yet, so the platform default is used.</p> : null}
    </div>
  );
}

/** Settings card for tenant admins. */
export function AiModelCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu size={16} /> AI model
        </CardTitle>
        <CardDescription>
          The model behind your chatbot, content, reports and other AI features. Quick background checks always use the platform&apos;s fast model.
          {isAdmin ? "" : " Only admins can change it."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AiModelPicker endpoint="/api/ai/model" canEdit={isAdmin} />
      </CardContent>
    </Card>
  );
}
