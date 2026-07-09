"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Loader2,
  Settings2,
  Mail,
  Archive,
  ClipboardCheck,
  Save,
  Send,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { cn } from "@/lib/utils";

type SetupCheckStatus = "ok" | "warning" | "error";

interface SetupCheck {
  id: string;
  label: string;
  status: SetupCheckStatus;
  message: string;
  required: boolean;
}

interface PlatformConfig {
  platformName: string;
  platformTagline: string;
  supportEmail: string | null;
  supportPhone: string | null;
  defaultSignupPlan: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  emailFromName: string;
  emailFromAddress: string | null;
  allowPublicSignup: boolean;
  enforcePlatform2fa: boolean;
}

interface EmailInfo {
  provider: string;
  configured: boolean;
  smtpHost: string | null;
  fromEnv: string | null;
  paystackConfigured: boolean;
  flutterwaveConfigured: boolean;
  openaiConfigured: boolean;
}

interface PlanRetention {
  name: string;
  auditRetentionDays: number;
  chatRetentionDays: number;
  leadRetentionDays: number;
  tenantCount: number;
}

const STATUS_ICON = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const STATUS_STYLE = {
  ok: "text-emerald-600",
  warning: "text-amber-600",
  error: "text-destructive",
};

export function PlatformSetupPanel() {
  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(false);
  const [checks, setChecks] = React.useState<SetupCheck[]>([]);
  const [summary, setSummary] = React.useState({ ok: 0, warning: 0, error: 0 });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/platform-config?status=1", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setReady(data.setup?.ready ?? false);
      setChecks(data.setup?.checks ?? []);
      setSummary(data.setup?.summary ?? { ok: 0, warning: 0, error: 0 });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load setup status");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  const total = checks.length || 1;
  const progress = Math.round((summary.ok / total) * 100);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Required Configuration
            </CardTitle>
            <CardDescription>
              Platform readiness checklist — resolve errors before going live.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {ready ? "Platform ready" : "Action required"}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {summary.ok}/{total} checks passing
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
                <Badge variant={ready ? "default" : "destructive"} className="shrink-0">
                  {ready ? "Ready" : "Not ready"}
                </Badge>
              </div>

              <div className="rounded-lg border divide-y">
                {checks.map((c) => {
                  const Icon = STATUS_ICON[c.status];
                  return (
                    <div key={c.id} className="flex items-start gap-3 p-3">
                      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", STATUS_STYLE[c.status])} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{c.label}</span>
                          {c.required && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1">
                              Required
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{c.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PlatformGeneralPanel() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    platformName: "",
    platformTagline: "",
    supportEmail: "",
    supportPhone: "",
    defaultSignupPlan: "free",
    maintenanceMode: false,
    maintenanceMessage: "",
    allowPublicSignup: true,
    enforcePlatform2fa: false,
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/platform-config", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      const c = data.config;
      setForm({
        platformName: c.platformName || "",
        platformTagline: c.platformTagline || "",
        supportEmail: c.supportEmail || "",
        supportPhone: c.supportPhone || "",
        defaultSignupPlan: c.defaultSignupPlan || "free",
        maintenanceMode: c.maintenanceMode ?? false,
        maintenanceMessage: c.maintenanceMessage || "",
        allowPublicSignup: c.allowPublicSignup ?? true,
        enforcePlatform2fa: c.enforcePlatform2fa ?? false,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformName: form.platformName.trim(),
          platformTagline: form.platformTagline.trim(),
          supportEmail: form.supportEmail.trim() || null,
          supportPhone: form.supportPhone.trim() || null,
          defaultSignupPlan: form.defaultSignupPlan,
          maintenanceMode: form.maintenanceMode,
          maintenanceMessage: form.maintenanceMessage.trim() || null,
          allowPublicSignup: form.allowPublicSignup,
          enforcePlatform2fa: form.enforcePlatform2fa,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success("General settings saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> General Settings
        </CardTitle>
        <CardDescription>Platform identity, signup defaults, and maintenance mode.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Platform name</Label>
            <Input
              value={form.platformName}
              onChange={(e) => setForm((f) => ({ ...f, platformName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tagline</Label>
            <Input
              value={form.platformTagline}
              onChange={(e) => setForm((f) => ({ ...f, platformTagline: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Support email</Label>
            <Input
              type="email"
              value={form.supportEmail}
              onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
              placeholder="support@danetstecpro.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Support phone</Label>
            <Input
              value={form.supportPhone}
              onChange={(e) => setForm((f) => ({ ...f, supportPhone: e.target.value }))}
              placeholder="+234 ..."
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Default plan for new tenants</Label>
          <Select
            value={form.defaultSignupPlan}
            onValueChange={(v) => setForm((f) => ({ ...f, defaultSignupPlan: v }))}
          >
            <SelectTrigger className="sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Maintenance mode</Label>
              <p className="text-xs text-muted-foreground">Block tenant access with a message</p>
            </div>
            <Switch
              checked={form.maintenanceMode}
              onCheckedChange={(v) => setForm((f) => ({ ...f, maintenanceMode: v }))}
            />
          </div>
          {form.maintenanceMode && (
            <Textarea
              rows={2}
              placeholder="We're performing scheduled maintenance..."
              value={form.maintenanceMessage}
              onChange={(e) => setForm((f) => ({ ...f, maintenanceMessage: e.target.value }))}
            />
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <Label className="text-sm">Allow public signup</Label>
              <p className="text-[11px] text-muted-foreground">New businesses can register</p>
            </div>
            <Switch
              checked={form.allowPublicSignup}
              onCheckedChange={(v) => setForm((f) => ({ ...f, allowPublicSignup: v }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <Label className="text-sm">Require platform 2FA</Label>
              <p className="text-[11px] text-muted-foreground">All admins must enable TOTP</p>
            </div>
            <Switch
              checked={form.enforcePlatform2fa}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enforcePlatform2fa: v }))}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save general settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlatformEmailPanel() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [emailInfo, setEmailInfo] = React.useState<EmailInfo | null>(null);
  const [form, setForm] = React.useState({ emailFromName: "", emailFromAddress: "" });
  const [testTo, setTestTo] = React.useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/platform-config", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setEmailInfo(data.email);
      setForm({
        emailFromName: data.config.emailFromName || "",
        emailFromAddress: data.config.emailFromAddress || "",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load email settings");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailFromName: form.emailFromName.trim(),
          emailFromAddress: form.emailFromAddress.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      toast.success("Email sender settings saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/super-admin/platform-config/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Send failed");
      toast.success(data.message || "Test email sent");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Test send failed");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Delivery
          </CardTitle>
          <CardDescription>
            Provider credentials are set via environment variables. Configure the sender identity here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-3 grid sm:grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Provider: </span>
              <Badge variant={emailInfo?.configured ? "default" : "secondary"}>
                {emailInfo?.provider || "none"}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Env from-address: </span>
              <span className="font-mono text-xs">{emailInfo?.fromEnv || "—"}</span>
            </div>
            {emailInfo?.smtpHost && (
              <div className="sm:col-span-2 text-xs text-muted-foreground">
                SMTP: {emailInfo.smtpHost}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Environment variables</p>
            <p>
              Set <code>EMAIL_PROVIDER</code> to <code>smtp</code> or <code>sendgrid</code>, plus{" "}
              <code>SMTP_*</code> or <code>SENDGRID_API_KEY</code> / <code>SENDGRID_FROM</code>.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From display name</Label>
              <Input
                value={form.emailFromName}
                onChange={(e) => setForm((f) => ({ ...f, emailFromName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>From email address</Label>
              <Input
                type="email"
                value={form.emailFromAddress}
                onChange={(e) => setForm((f) => ({ ...f, emailFromAddress: e.target.value }))}
                placeholder={emailInfo?.fromEnv || "noreply@example.com"}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} variant="outline" className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save sender settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Send test email</CardTitle>
          <CardDescription>Verify your email provider configuration.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            placeholder="you@company.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className="sm:max-w-sm"
          />
          <Button onClick={sendTest} disabled={sending || !testTo.trim()} className="gap-1.5">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send test
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function PlatformRetentionPanel() {
  const [plans, setPlans] = React.useState<PlanRetention[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [applying, setApplying] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/plans", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setPlans(
        (data.plans || []).map((p: PlanRetention & { id: string }) => ({
          name: p.name,
          auditRetentionDays: p.auditRetentionDays,
          chatRetentionDays: p.chatRetentionDays,
          leadRetentionDays: p.leadRetentionDays,
          tenantCount: p.tenantCount,
        }))
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load retention policies");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function applyAll() {
    setApplying(true);
    setConfirmOpen(false);
    try {
      const res = await fetch("/api/super-admin/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_retention_all" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retention apply failed");

      const results = (data.results || []) as Array<{
        deleted?: { auditLogs: number; chatSessions: number; leads: number };
        businessName?: string;
      }>;
      const totals = results.reduce(
        (acc, r) => {
          if (r.deleted) {
            acc.audit += r.deleted.auditLogs;
            acc.chats += r.deleted.chatSessions;
            acc.leads += r.deleted.leads;
          }
          return acc;
        },
        { audit: 0, chats: 0, leads: 0 }
      );
      setLastResult(
        `Purged ${totals.audit} audit logs, ${totals.chats} chat sessions, ${totals.leads} leads across ${results.length} tenant(s).`
      );
      toast.success("Retention policy applied to all tenants");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Retention apply failed");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Archive className="h-4 w-4" /> Data Retention Policies
            </CardTitle>
            <CardDescription>
              Per-plan retention windows. Edit days in the Plans tab. Purge removes records older than each
              tenant&apos;s plan policy.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={applying}
              onClick={() => setConfirmOpen(true)}
              className="gap-1.5"
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Apply to all tenants
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {lastResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
              {lastResult}
            </div>
          )}
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Audit logs</TableHead>
                  <TableHead>Chat sessions</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Tenants</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="capitalize font-medium">{p.name}</TableCell>
                    <TableCell className="tabular-nums">{p.auditRetentionDays} days</TableCell>
                    <TableCell className="tabular-nums">{p.chatRetentionDays} days</TableCell>
                    <TableCell className="tabular-nums">{p.leadRetentionDays} days</TableCell>
                    <TableCell>{p.tenantCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply retention to all tenants?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes audit logs, chat sessions, and leads older than each tenant&apos;s
              plan retention window. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={applyAll}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Apply retention
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
