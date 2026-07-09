"use client";

import * as React from "react";
import { toast } from "sonner";
import { Globe, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function TenantWhiteLabelEditor({
  businessId,
  plan,
}: {
  businessId: string;
  plan: string;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    customDomain: "",
    appName: "",
    primaryColor: "#1d4ed8",
    hideBranding: false,
    isActive: false,
  });

  const isEnterprise = plan === "enterprise";

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/super-admin/businesses/${businessId}/white-label`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const c = data.config;
        if (c) {
          setForm({
            customDomain: c.customDomain || "",
            appName: c.appName || "",
            primaryColor: c.primaryColor || "#1d4ed8",
            hideBranding: c.hideBranding ?? false,
            isActive: c.isActive ?? false,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}/white-label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customDomain: form.customDomain.trim() || null,
          appName: form.appName.trim() || undefined,
          primaryColor: form.primaryColor,
          hideBranding: form.hideBranding,
          isActive: form.isActive,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      toast.success("White-label settings saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Globe className="h-3.5 w-3.5" /> Custom Domain & White Label
      </div>
      {!isEnterprise && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Custom domains are intended for Enterprise tenants. You can still configure for testing.
        </p>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Custom domain</Label>
        <Input
          value={form.customDomain}
          onChange={(e) => setForm((f) => ({ ...f, customDomain: e.target.value }))}
          placeholder="app.clientcompany.com"
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">App display name</Label>
        <Input
          value={form.appName}
          onChange={(e) => setForm((f) => ({ ...f, appName: e.target.value }))}
          placeholder="Client Company AI"
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
        <Label className="text-xs">Hide Danets branding</Label>
        <Switch
          checked={form.hideBranding}
          onCheckedChange={(v) => setForm((f) => ({ ...f, hideBranding: v }))}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
        <Label className="text-xs">White-label active</Label>
        <Switch
          checked={form.isActive}
          onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save white-label
        </Button>
      </div>
    </div>
  );
}
