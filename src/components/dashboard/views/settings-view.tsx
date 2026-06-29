"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, Building2, ShieldCheck, KeyRound, Database } from "lucide-react";
import { toast } from "sonner";

interface BusinessInfo {
  business: {
    id: string;
    name: string;
    publicKey: string;
    industry: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    plan: string;
    status: string;
    createdAt: string;
  };
  plan: { name: string; priceUsd: number; chatLimit: number; leadLimit: number; kbLimit: number; features: string } | null;
  counts: { agents: number; kbItems: number; sessions: number; leads: number };
}

export function SettingsView({ user }: { user: any }) {
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", industry: "", email: "", phone: "", whatsapp: "" });

  useEffect(() => {
    fetch("/api/business")
      .then((r) => r.json())
      .then((d) => {
        setInfo(d);
        setForm({
          name: d.business?.name || "",
          industry: d.business?.industry || "",
          email: d.business?.email || "",
          phone: d.business?.phone || "",
          whatsapp: d.business?.whatsapp || "",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/business", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success("Settings saved");
      setInfo((prev) => (prev ? { ...prev, business: { ...prev.business!, ...d.business } } : prev));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function copyPk() {
    if (!info?.business?.publicKey) return;
    await navigator.clipboard.writeText(info.business.publicKey);
    toast.success("Public key copied");
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const b = info?.business;
  const plan = info?.plan;
  const features: string[] = plan ? JSON.parse(plan.features || "[]") : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your business profile, plan, and account details.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Business profile */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 size={16} /> Business Profile
              </CardTitle>
              <CardDescription>Public information about your business</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                <Field label="Industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} />
                <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
                <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                <Field label="WhatsApp" value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} />
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* API & widget key */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound size={16} /> Public API Key
              </CardTitle>
              <CardDescription>
                Use this key in your widget embed code. It is safe to expose publicly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-muted px-3 py-2.5 text-sm font-mono break-all">
                  {b?.publicKey}
                </code>
                <Button variant="outline" size="sm" onClick={copyPk}>
                  Copy
                </Button>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck size={14} className="text-accent-foreground mt-0.5 shrink-0" />
                <span>
                  This key only identifies your business publicly for the chat widget. Your admin API requires authentication and is never exposed. Never share your login credentials.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: plan + usage + security */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold capitalize">{b?.plan}</span>
                <Badge variant="secondary">${plan?.priceUsd ?? 0}/mo</Badge>
              </div>
              <Separator />
              <div className="space-y-1.5 text-sm">
                <LimitRow label="AI agents" used={info?.counts.agents ?? 0} limit={plan?.kbLimit ?? 0} />
                <LimitRow label="Knowledge items" used={info?.counts.kbItems ?? 0} limit={plan?.kbLimit ?? 0} />
                <LimitRow label="Chat sessions" used={info?.counts.sessions ?? 0} limit={plan?.chatLimit ?? 0} />
                <LimitRow label="Leads" used={info?.counts.leads ?? 0} limit={plan?.leadLimit ?? 0} />
              </div>
              {features.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    {features.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-sm">
                        <ShieldCheck size={14} className="text-accent-foreground" />
                        {f}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Database size={16} /> Account Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Status" value={<Badge variant="outline" className="capitalize">{b?.status}</Badge>} />
              <Row label="Created" value={b ? new Date(b.createdAt).toLocaleDateString() : "-"} />
              <Row label="Signed in as" value={user.email} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck size={16} /> Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>• All AI keys are stored server-side only (never exposed to the browser).</p>
              <p>• Public chat endpoint is rate-limited (30 messages / 10 min / IP).</p>
              <p>• Business-level data isolation enforced on every query.</p>
              <p>• All AI usage is logged with token & cost tracking.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-10" />
    </div>
  );
}

function LimitRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {used} <span className="text-muted-foreground">/ {limit}</span>
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
