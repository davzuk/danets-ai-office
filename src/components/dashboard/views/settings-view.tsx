"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Save,
  Building2,
  ShieldCheck,
  KeyRound,
  Database,
  Bell,
  Mail,
  Palette,
  Download,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { TeamMembers } from "@/components/dashboard/views/team-members";
import { BrandVoiceCard } from "@/components/dashboard/views/brand-voice-card";
import { TotpSecurityCard } from "@/components/dashboard/shared/totp-security-card";
import { planRank, formatPlanLabel } from "@/lib/module-registry";
import { Lock, Sparkles } from "lucide-react";

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

interface NotificationPreference {
  type: string;
  label: string;
  inApp: boolean;
  email: boolean;
}

interface WhiteLabelConfig {
  appName: string;
  appShortName: string;
  primaryColor: string;
  accentColor: string;
  customDomain: string;
  customLogoUrl: string;
  hideBranding: boolean;
  isActive: boolean;
}

export function SettingsView({
  user,
  onNavigate,
}: {
  user: any;
  onNavigate?: (view: string) => void;
}) {
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", industry: "", email: "", phone: "", whatsapp: "" });
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);

  const [wl, setWl] = useState<WhiteLabelConfig>({
    appName: "",
    appShortName: "",
    primaryColor: "#1d4ed8",
    accentColor: "#84cc16",
    customDomain: "",
    customLogoUrl: "",
    hideBranding: false,
    isActive: false,
  });
  const [wlLoading, setWlLoading] = useState(true);
  const [wlSaving, setWlSaving] = useState(false);

  const [gdprExporting, setGdprExporting] = useState(false);
  const [gdprDeleting, setGdprDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

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

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((r) => r.json())
      .then((d) => setPrefs(d.preferences ?? []))
      .catch(() => toast.error("Failed to load notification preferences"))
      .finally(() => setPrefsLoading(false));
  }, []);

  useEffect(() => {
    if (!info?.business?.plan) return;
    if (planRank(info.business.plan) < planRank("enterprise")) {
      setWlLoading(false);
      return;
    }
    fetch("/api/white-label")
      .then((r) => r.json())
      .then((d) => {
        if (d?.config) {
          setWl({
            appName: d.config.appName || "",
            appShortName: d.config.appShortName || "",
            primaryColor: d.config.primaryColor || "#1d4ed8",
            accentColor: d.config.accentColor || "#84cc16",
            customDomain: d.config.customDomain || "",
            customLogoUrl: d.config.customLogoUrl || "",
            hideBranding: !!d.config.hideBranding,
            isActive: !!d.config.isActive,
          });
        }
      })
      .catch(() => toast.error("Failed to load white-label configuration"))
      .finally(() => setWlLoading(false));
  }, [info?.business?.plan]);

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

  function updatePref(type: string, channel: "inApp" | "email", value: boolean) {
    setPrefs((prev) => prev.map((p) => (p.type === type ? { ...p, [channel]: value } : p)));
  }

  async function savePreferences() {
    setPrefsSaving(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: prefs.map((p) => ({ type: p.type, inApp: p.inApp, email: p.email })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save preferences");
      toast.success("Notification preferences saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPrefsSaving(false);
    }
  }

  async function saveWhiteLabel() {
    setWlSaving(true);
    try {
      const res = await fetch("/api/white-label", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: wl.appName,
          appShortName: wl.appShortName,
          primaryColor: wl.primaryColor,
          accentColor: wl.accentColor,
          customDomain: wl.customDomain,
          customLogoUrl: wl.customLogoUrl,
          hideBranding: wl.hideBranding,
          isActive: wl.isActive,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save branding");
      toast.success("Branding saved");
      if (d?.config) {
        setWl((prev) => ({
          ...prev,
          appName: d.config.appName || prev.appName,
          appShortName: d.config.appShortName || prev.appShortName,
          primaryColor: d.config.primaryColor || prev.primaryColor,
          accentColor: d.config.accentColor || prev.accentColor,
          customDomain: d.config.customDomain || "",
          customLogoUrl: d.config.customLogoUrl || "",
          hideBranding: !!d.config.hideBranding,
          isActive: !!d.config.isActive,
        }));
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setWlSaving(false);
    }
  }

  async function exportData() {
    setGdprExporting(true);
    toast.success("Downloading data export…");
    try {
      const res = await fetch("/api/gdpr/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/i);
      a.download =
        m?.[1] || `danets-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setGdprExporting(false);
    }
  }

  async function deleteAllData() {
    setGdprDeleting(true);
    try {
      const res = await fetch("/api/gdpr/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE ALL MY DATA" }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || "Delete failed");
      toast.success("All data deleted. Redirecting…");
      setDeleteDialogOpen(false);
      setDeleteConfirmText("");
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGdprDeleting(false);
    }
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

          {/* Brand Voice (used by every AI content generator) */}
          <BrandVoiceCard />

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

          {/* Team members */}
          {info?.business && (
            <TeamMembers
              businessId={info.business.id}
              currentUserRole={user.role}
              currentUserId={user.userId}
            />
          )}

          {/* White-Label & Branding */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette size={16} /> White-Label & Branding
              </CardTitle>
              <CardDescription>
                Customize the appearance for your resellers or sub-brands.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {info?.business && planRank(info.business.plan) < planRank("enterprise") ? (
                <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Lock className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    White-label branding is available on the{" "}
                    <strong>{formatPlanLabel("enterprise")}</strong> plan. Your current plan is{" "}
                    <strong>{formatPlanLabel(info.business.plan)}</strong>.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => onNavigate?.("subscription")}
                  >
                    <Sparkles className="h-4 w-4" />
                    View plans & upgrade
                  </Button>
                </div>
              ) : wlLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">App Name</Label>
                      <Input
                        value={wl.appName}
                        onChange={(e) => setWl({ ...wl, appName: e.target.value })}
                        placeholder="My Brand"
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">App Short Name</Label>
                      <Input
                        value={wl.appShortName}
                        onChange={(e) => setWl({ ...wl, appShortName: e.target.value })}
                        placeholder="MB"
                        maxLength={20}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Primary Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={wl.primaryColor}
                          onChange={(e) => setWl({ ...wl, primaryColor: e.target.value })}
                          className="h-10 w-12 shrink-0 rounded-md border bg-transparent p-1 cursor-pointer"
                          aria-label="Primary color picker"
                        />
                        <Input
                          value={wl.primaryColor}
                          onChange={(e) => setWl({ ...wl, primaryColor: e.target.value })}
                          className="h-10 font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Accent Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={wl.accentColor}
                          onChange={(e) => setWl({ ...wl, accentColor: e.target.value })}
                          className="h-10 w-12 shrink-0 rounded-md border bg-transparent p-1 cursor-pointer"
                          aria-label="Accent color picker"
                        />
                        <Input
                          value={wl.accentColor}
                          onChange={(e) => setWl({ ...wl, accentColor: e.target.value })}
                          className="h-10 font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Custom Domain</Label>
                      <Input
                        value={wl.customDomain}
                        onChange={(e) => setWl({ ...wl, customDomain: e.target.value })}
                        placeholder="app.mybrand.com"
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Custom Logo URL</Label>
                      <Input
                        value={wl.customLogoUrl}
                        onChange={(e) => setWl({ ...wl, customLogoUrl: e.target.value })}
                        placeholder="https://…/logo.png"
                        className="h-10"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 pt-1">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={wl.hideBranding}
                        onCheckedChange={(v) => setWl({ ...wl, hideBranding: v })}
                        aria-label="Hide Powered by Danets"
                      />
                      <Label className="text-sm cursor-pointer">Hide “Powered by Danets”</Label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={wl.isActive}
                        onCheckedChange={(v) => setWl({ ...wl, isActive: v })}
                        aria-label="Activate white-label"
                      />
                      <Label className="text-sm cursor-pointer">Active</Label>
                      {wl.isActive ? (
                        <Badge variant="secondary" className="bg-accent text-accent-foreground">Live</Badge>
                      ) : (
                        <Badge variant="outline">Disabled</Badge>
                      )}
                    </div>
                  </div>

                  {/* Live Preview */}
                  <div className="rounded-lg border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
                      Live Preview
                    </div>
                    <div
                      className="flex items-center justify-between rounded-md p-3"
                      style={{ backgroundColor: wl.primaryColor }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {wl.customLogoUrl ? (
                          <img
                            src={wl.customLogoUrl}
                            alt="Logo preview"
                            className="h-6 w-6 shrink-0 rounded object-contain"
                          />
                        ) : (
                          <div className="h-6 w-6 shrink-0 rounded bg-white/20 flex items-center justify-center text-xs font-bold text-white">
                            {(wl.appShortName || "A").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="font-semibold text-white truncate">
                          {wl.appName || "Your App Name"}
                        </span>
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ml-2"
                        style={{ backgroundColor: wl.accentColor, color: "#1a1a1a" }}
                      >
                        {wl.isActive ? "Active" : "Preview"}
                      </span>
                    </div>
                    {!wl.hideBranding && (
                      <div className="mt-2 text-center text-[10px] text-muted-foreground">
                        Powered by Danets
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-1">
                    <Button onClick={saveWhiteLabel} disabled={wlSaving}>
                      {wlSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save Branding
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Data & Privacy (GDPR) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck size={16} /> Data & Privacy
              </CardTitle>
              <CardDescription>
                Export or delete your business data (GDPR compliance).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 px-3 py-2.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Export includes all leads, chats, tickets, proposals, documents, and settings. Deletion is permanent and cannot be undone.
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button variant="outline" onClick={exportData} disabled={gdprExporting}>
                  {gdprExporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Export All Data
                </Button>
                <AlertDialog open={deleteDialogOpen} onOpenChange={(o) => { setDeleteDialogOpen(o); if (!o) setDeleteConfirmText(""); }}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={gdprDeleting}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete All Data
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle size={18} /> Permanently delete all data?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. All leads, chats, tickets, proposals,
                        documents, settings, and your business account will be permanently
                        deleted. You will be signed out immediately.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                      <Label className="text-xs">
                        Type{" "}
                        <span className="font-mono font-semibold text-destructive">
                          DELETE ALL MY DATA
                        </span>{" "}
                        to confirm
                      </Label>
                      <Input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE ALL MY DATA"
                        className="font-mono"
                        autoComplete="off"
                      />
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={gdprDeleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          if (deleteConfirmText !== "DELETE ALL MY DATA") {
                            toast.error('Type "DELETE ALL MY DATA" to confirm');
                            return;
                          }
                          deleteAllData();
                        }}
                        disabled={deleteConfirmText !== "DELETE ALL MY DATA" || gdprDeleting}
                        className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {gdprDeleting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Delete Everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>

          {/* Notification preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell size={16} /> Notification Preferences
              </CardTitle>
              <CardDescription>
                Choose which notifications you receive in-app and via email.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {prefsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-4 items-center pb-2 border-b text-xs text-muted-foreground uppercase tracking-wide">
                    <div>Notification Type</div>
                    <div className="text-center w-16">In-App</div>
                    <div className="text-center w-16">Email</div>
                  </div>
                  <div className="space-y-3">
                    {prefs.map((p) => (
                      <div
                        key={p.type}
                        className="grid grid-cols-[1fr_auto_auto] gap-4 items-center"
                      >
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="flex justify-center w-16">
                          <Switch
                            checked={p.inApp}
                            onCheckedChange={(v) => updatePref(p.type, "inApp", v)}
                          />
                        </div>
                        <div className="flex justify-center w-16">
                          <Switch
                            checked={p.email}
                            onCheckedChange={(v) => updatePref(p.type, "email", v)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 px-3 py-2.5">
                    <Mail size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Email notifications require an email provider to be configured in Integrations.
                    </span>
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button onClick={savePreferences} disabled={prefsSaving}>
                      {prefsSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save Preferences
                    </Button>
                  </div>
                </>
              )}
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
              <CardDescription>
                Account protection and platform security practices.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <TenantTotpSecurityCard />
              <Enforce2faToggle />
              <Separator />
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>• All AI keys are stored server-side only (never exposed to the browser).</p>
                <p>• Public chat endpoint is rate-limited (30 messages / 10 min / IP).</p>
                <p>• Business-level data isolation enforced on every query.</p>
                <p>• All AI usage is logged with token & cost tracking.</p>
              </div>
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

/**
 * Tenant-wrapped TotpSecurityCard that pulls the enforce2fa policy flag
 * alongside the user's totp status so the "Disable 2FA" button is locked
 * when the tenant has forced 2FA on.
 */
function TenantTotpSecurityCard() {
  const [enforce2fa, setEnforce2fa] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setEnforce2fa(!!data?.user?.enforce2fa);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TotpSecurityCard
      setupPath="/api/auth/totp/setup"
      loadStatus={async () => {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (!data.user) return null;
        return {
          email: data.user.email,
          totpEnabled: !!data.user.totpEnabled,
        };
      }}
      title="Two-factor authentication"
      description="Optional TOTP for your tenant account. Required at sign-in when enabled or when your organization mandates it."
      disableBlocked={enforce2fa && loaded}
      disableBlockedMessage="2FA is required by your organization's policy and cannot be disabled."
    />
  );
}

/**
 * Tenant-level policy switch: when enabled, every member of this business
 * is required to use 2FA on sign-in. The login route enforces this on the
 * server; the /api/auth/totp/setup DELETE endpoint refuses to disable 2FA
 * while the policy is on.
 */
function Enforce2faToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setEnabled(!!data?.user?.enforce2fa);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/business", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforce2fa: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update policy");
      setEnabled(next);
      toast.success(
        next
          ? "2FA is now required for every member of your organization."
          : "2FA requirement removed for your organization."
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update policy");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="rounded-lg border p-3 flex items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Require 2FA for all members</div>
        <p className="text-xs text-muted-foreground">
          When enabled, every member of your organization must set up
          two-factor authentication before signing in. Members who haven&apos;t
          set up 2FA will be blocked at sign-in and guided through setup.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={busy}
        aria-label="Require 2FA for all members"
      />
    </div>
  );
}
