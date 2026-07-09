"use client";

import * as React from "react";
import { toast } from "sonner";
import { Gauge, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface LimitsData {
  businessId: string;
  plan: string;
  planDefaults: {
    chatLimit: number;
    leadLimit: number;
    kbLimit: number;
    agentLimit: number;
  };
  override: {
    chatLimit: number | null;
    leadLimit: number | null;
    kbLimit: number | null;
    agentLimit: number | null;
    notes: string | null;
    updatedAt: string;
  } | null;
}

function numOrEmpty(v: number | null | undefined) {
  return v == null ? "" : String(v);
}

export function TenantLimitOverrides({
  businessId,
  businessName,
  onSaved,
}: {
  businessId: string;
  businessName: string;
  onSaved?: () => void;
}) {
  const [data, setData] = React.useState<LimitsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    chatLimit: "",
    leadLimit: "",
    kbLimit: "",
    agentLimit: "",
    notes: "",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}/limits`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setData(json);
      const o = json.override;
      setForm({
        chatLimit: numOrEmpty(o?.chatLimit),
        leadLimit: numOrEmpty(o?.leadLimit),
        kbLimit: numOrEmpty(o?.kbLimit),
        agentLimit: numOrEmpty(o?.agentLimit),
        notes: o?.notes || "",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load limits");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [businessId]);

  function parseOptionalInt(v: string): number | null {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : n;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}/limits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatLimit: parseOptionalInt(form.chatLimit),
          leadLimit: parseOptionalInt(form.leadLimit),
          kbLimit: parseOptionalInt(form.kbLimit),
          agentLimit: parseOptionalInt(form.agentLimit),
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`Quota overrides saved for ${businessName}`);
      await load();
      onSaved?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearOverrides() {
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}/limits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Reverted to plan defaults");
      await load();
      onSaved?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5" /> Custom Quota Overrides
        </div>
        {data.override && (
          <Badge variant="outline" className="text-[10px]">
            Override active
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Leave blank to use the <strong className="capitalize">{data.plan}</strong> plan
        default. Set a value to override for this tenant only.
      </p>
      <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
        <span>Plan defaults:</span>
        <span className="text-right tabular-nums">
          {data.planDefaults.chatLimit} chats · {data.planDefaults.leadLimit} leads ·{" "}
          {data.planDefaults.kbLimit} KB · {data.planDefaults.agentLimit} agents
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Chat limit/mo</Label>
          <Input
            value={form.chatLimit}
            onChange={(e) => setForm((f) => ({ ...f, chatLimit: e.target.value }))}
            placeholder={String(data.planDefaults.chatLimit)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Lead limit/mo</Label>
          <Input
            value={form.leadLimit}
            onChange={(e) => setForm((f) => ({ ...f, leadLimit: e.target.value }))}
            placeholder={String(data.planDefaults.leadLimit)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">KB items (total)</Label>
          <Input
            value={form.kbLimit}
            onChange={(e) => setForm((f) => ({ ...f, kbLimit: e.target.value }))}
            placeholder={String(data.planDefaults.kbLimit)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">AI agents (total)</Label>
          <Input
            value={form.agentLimit}
            onChange={(e) => setForm((f) => ({ ...f, agentLimit: e.target.value }))}
            placeholder={String(data.planDefaults.agentLimit)}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Notes (internal)</Label>
        <Textarea
          rows={2}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="e.g. Enterprise deal — 2× chat quota until Dec 2026"
          className="text-sm resize-none"
        />
      </div>
      <div className="flex gap-2 justify-end">
        {data.override && (
          <Button
            size="sm"
            variant="outline"
            onClick={clearOverrides}
            disabled={saving}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to plan
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save overrides
        </Button>
      </div>
    </div>
  );
}
