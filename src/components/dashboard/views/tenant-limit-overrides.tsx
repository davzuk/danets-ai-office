"use client";

import * as React from "react";
import { toast } from "sonner";
import { Gauge, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LIMIT_FIELDS, formatLimit, type LimitKey, type LimitOverrides, type LimitValues } from "@/lib/limit-fields";

interface LimitsData {
  businessId: string;
  plan: string;
  planDefaults: LimitValues;
  override: (LimitOverrides & { notes: string | null; updatedAt: string }) | null;
}

type Form = Record<LimitKey, string> & { notes: string };

function toForm(o: LimitsData["override"]): Form {
  return {
    ...(Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, o?.[f.key] == null ? "" : String(o[f.key])])) as Record<LimitKey, string>),
    notes: o?.notes || "",
  };
}

function parseOptionalInt(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
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
  const [form, setForm] = React.useState<Form>(() => toForm(null));

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}/limits`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json: LimitsData = await res.json();
      setData(json);
      setForm(toForm(json.override));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load limits");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  React.useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}/limits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, parseOptionalInt(form[f.key])])),
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
  const overridden = LIMIT_FIELDS.filter((f) => data.override?.[f.key] != null).length;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5" /> Custom Quota Overrides
        </div>
        {data.override && overridden > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {overridden} override{overridden === 1 ? "" : "s"} active
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Leave blank to use the <strong className="capitalize">{data.plan}</strong> plan value (shown greyed out). Enter a
        number to override it for this tenant only; 0 means unlimited.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {LIMIT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs" title={"hint" in f ? f.hint : undefined}>
              {f.label}{" "}
              <span className="font-normal text-muted-foreground">({f.unit === "/mo" ? "per month" : f.unit === "MB" ? "MB" : "total"})</span>
            </Label>
            <Input
              value={form[f.key]}
              onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
              placeholder={`${formatLimit(data.planDefaults[f.key], f.unit)} (plan)`}
              inputMode="numeric"
              className="h-8 text-sm"
            />
          </div>
        ))}
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
