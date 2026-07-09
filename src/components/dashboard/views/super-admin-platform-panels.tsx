"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Crown,
  Megaphone,
  Flag,
  RefreshCw,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  ToggleLeft,
  Shield,
  KeyRound,
  Copy,
  ClipboardCheck,
  Settings2,
  Mail,
  Archive,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  PlatformSetupPanel,
  PlatformGeneralPanel,
  PlatformEmailPanel,
  PlatformRetentionPanel,
} from "@/components/dashboard/views/platform-settings-panels";

const PLAN_BADGE: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  starter: "bg-primary text-primary-foreground",
  pro: "bg-accent text-accent-foreground",
  enterprise: "bg-violet-600 text-white",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-700",
  warning: "bg-amber-500/15 text-amber-700",
  critical: "bg-destructive/15 text-destructive",
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

interface PlanRow {
  id: string;
  name: string;
  priceUsd: number;
  chatLimit: number;
  leadLimit: number;
  kbLimit: number;
  agentLimit: number;
  auditRetentionDays: number;
  chatRetentionDays: number;
  leadRetentionDays: number;
  features: string[];
  isActive: boolean;
  tenantCount: number;
}

interface AnnouncementRow {
  id: string;
  title: string;
  message: string;
  severity: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
}

interface FlagRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  overrideCount: number;
}

export function SuperAdminPlatformPanel({
  businesses,
}: {
  businesses: { id: string; name: string }[];
}) {
  return (
    <Tabs defaultValue="setup" className="space-y-4">
      <TabsList className="flex flex-wrap h-auto gap-1">
        <TabsTrigger value="setup" className="gap-1.5">
          <ClipboardCheck className="h-3.5 w-3.5" /> Setup
        </TabsTrigger>
        <TabsTrigger value="general" className="gap-1.5">
          <Settings2 className="h-3.5 w-3.5" /> General
        </TabsTrigger>
        <TabsTrigger value="plans" className="gap-1.5">
          <Crown className="h-3.5 w-3.5" /> Plans
        </TabsTrigger>
        <TabsTrigger value="email" className="gap-1.5">
          <Mail className="h-3.5 w-3.5" /> Email
        </TabsTrigger>
        <TabsTrigger value="retention" className="gap-1.5">
          <Archive className="h-3.5 w-3.5" /> Retention
        </TabsTrigger>
        <TabsTrigger value="announcements" className="gap-1.5">
          <Megaphone className="h-3.5 w-3.5" /> Announcements
        </TabsTrigger>
        <TabsTrigger value="flags" className="gap-1.5">
          <Flag className="h-3.5 w-3.5" /> Feature Flags
        </TabsTrigger>
        <TabsTrigger value="security" className="gap-1.5">
          <Shield className="h-3.5 w-3.5" /> Security
        </TabsTrigger>
      </TabsList>
      <TabsContent value="setup" className="mt-0">
        <PlatformSetupPanel />
      </TabsContent>
      <TabsContent value="general" className="mt-0">
        <PlatformGeneralPanel />
      </TabsContent>
      <TabsContent value="plans" className="mt-0">
        <PlansPanel />
      </TabsContent>
      <TabsContent value="email" className="mt-0">
        <PlatformEmailPanel />
      </TabsContent>
      <TabsContent value="retention" className="mt-0">
        <PlatformRetentionPanel />
      </TabsContent>
      <TabsContent value="announcements" className="mt-0">
        <AnnouncementsPanel />
      </TabsContent>
      <TabsContent value="flags" className="mt-0">
        <FeatureFlagsPanel businesses={businesses} />
      </TabsContent>
      <TabsContent value="security" className="mt-0">
        <PlatformSecurityPanel />
      </TabsContent>
    </Tabs>
  );
}

function PlansPanel() {
  const [plans, setPlans] = React.useState<PlanRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editPlan, setEditPlan] = React.useState<PlanRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    priceUsd: "",
    chatLimit: "",
    leadLimit: "",
    kbLimit: "",
    agentLimit: "",
    auditRetentionDays: "",
    chatRetentionDays: "",
    leadRetentionDays: "",
    features: "",
    isActive: true,
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/plans", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setPlans(data.plans || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  function openEdit(plan: PlanRow) {
    setEditPlan(plan);
    setForm({
      priceUsd: String(plan.priceUsd),
      chatLimit: String(plan.chatLimit),
      leadLimit: String(plan.leadLimit),
      kbLimit: String(plan.kbLimit),
      agentLimit: String(plan.agentLimit ?? 1),
      auditRetentionDays: String(plan.auditRetentionDays ?? 30),
      chatRetentionDays: String(plan.chatRetentionDays ?? 90),
      leadRetentionDays: String(plan.leadRetentionDays ?? 365),
      features: plan.features.join("\n"),
      isActive: plan.isActive,
    });
  }

  async function savePlan() {
    if (!editPlan) return;
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editPlan.name,
          priceUsd: parseFloat(form.priceUsd) || 0,
          chatLimit: parseInt(form.chatLimit, 10) || 0,
          leadLimit: parseInt(form.leadLimit, 10) || 0,
          kbLimit: parseInt(form.kbLimit, 10) || 0,
          agentLimit: parseInt(form.agentLimit, 10) || 0,
          auditRetentionDays: parseInt(form.auditRetentionDays, 10) || 30,
          chatRetentionDays: parseInt(form.chatRetentionDays, 10) || 90,
          leadRetentionDays: parseInt(form.leadRetentionDays, 10) || 365,
          features: form.features
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          isActive: form.isActive,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`${editPlan.name} plan updated`);
      setEditPlan(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Crown className="h-4 w-4" /> Plan Catalog
            </CardTitle>
            <CardDescription>Edit pricing, limits, and features for subscription plans.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-6 pb-6 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Plan</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Tenants</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-6">
                      <Badge className={cn("capitalize", PLAN_BADGE[p.name] || "")}>{p.name}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtMoney(p.priceUsd)}/mo</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.chatLimit.toLocaleString()} chats · {p.leadLimit.toLocaleString()} leads ·{" "}
                      {p.kbLimit.toLocaleString()} KB · {p.agentLimit.toLocaleString()} agents
                    </TableCell>
                    <TableCell>{p.tenantCount}</TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"}>
                        {p.isActive ? "Active" : "Hidden"}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)} className="gap-1.5">
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editPlan} onOpenChange={(o) => !o && setEditPlan(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="capitalize">Edit {editPlan?.name} Plan</DialogTitle>
            <DialogDescription>Changes apply to new subscriptions and quota checks.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Monthly price (USD)</Label>
                <Input value={form.priceUsd} onChange={(e) => setForm((f) => ({ ...f, priceUsd: e.target.value }))} />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label>Visible in catalog</Label>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label>Chat limit/mo</Label>
                <Input value={form.chatLimit} onChange={(e) => setForm((f) => ({ ...f, chatLimit: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead limit/mo</Label>
                <Input value={form.leadLimit} onChange={(e) => setForm((f) => ({ ...f, leadLimit: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>KB limit (total)</Label>
                <Input value={form.kbLimit} onChange={(e) => setForm((f) => ({ ...f, kbLimit: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Agent limit (total)</Label>
                <Input value={form.agentLimit} onChange={(e) => setForm((f) => ({ ...f, agentLimit: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Audit retention (days)</Label>
                <Input value={form.auditRetentionDays} onChange={(e) => setForm((f) => ({ ...f, auditRetentionDays: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Chat retention (days)</Label>
                <Input value={form.chatRetentionDays} onChange={(e) => setForm((f) => ({ ...f, chatRetentionDays: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead retention (days)</Label>
                <Input value={form.leadRetentionDays} onChange={(e) => setForm((f) => ({ ...f, leadRetentionDays: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Features (one per line)</Label>
              <Textarea
                rows={5}
                value={form.features}
                onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlan(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={savePlan} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnnouncementsPanel() {
  const [items, setItems] = React.useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<AnnouncementRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    title: "",
    message: "",
    severity: "info",
    isActive: true,
    startsAt: "",
    endsAt: "",
  });

  function toLocalDatetime(iso: string) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openEdit(item: AnnouncementRow) {
    setEditItem(item);
    setForm({
      title: item.title,
      message: item.message,
      severity: item.severity,
      isActive: item.isActive,
      startsAt: toLocalDatetime(item.startsAt),
      endsAt: item.endsAt ? toLocalDatetime(item.endsAt) : "",
    });
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/announcements", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setItems(data.announcements || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!form.title.trim() || !form.message.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          message: form.message.trim(),
          severity: form.severity,
          isActive: form.isActive,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Announcement published");
      setCreateOpen(false);
      setForm({ title: "", message: "", severity: "info", isActive: true, startsAt: "", endsAt: "" });
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editItem || !form.title.trim() || !form.message.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/announcements/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          message: form.message.trim(),
          severity: form.severity,
          isActive: form.isActive,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Announcement updated");
      setEditItem(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: AnnouncementRow) {
    try {
      const res = await fetch(`/api/super-admin/announcements/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      setItems((prev) => prev.map((a) => (a.id === item.id ? { ...a, isActive: !a.isActive } : a)));
    } catch {
      toast.error("Failed to update");
    }
  }

  async function remove(id: string) {
    try {
      await fetch(`/api/super-admin/announcements/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== id));
      toast.success("Announcement removed");
    } catch {
      toast.error("Delete failed");
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4" /> Platform Announcements
            </CardTitle>
            <CardDescription>Broadcast messages shown to all tenant dashboards.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No announcements yet.</p>
          ) : (
            items.map((a) => (
              <div key={a.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{a.title}</span>
                      <Badge className={cn("text-xs capitalize", SEVERITY_STYLES[a.severity])}>{a.severity}</Badge>
                      {!a.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{a.message}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(a)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Switch checked={a.isActive} onCheckedChange={() => toggleActive(a)} />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
            <DialogDescription>Visible to all active tenants while published.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Starts at (optional)</Label>
                <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Ends at (optional)</Label>
              <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={create} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Announcement</DialogTitle>
            <DialogDescription>Update broadcast content and schedule.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label>Published</Label>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Starts at</Label>
                <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Ends at</Label>
                <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FeatureFlagsPanel({ businesses }: { businesses: { id: string; name: string }[] }) {
  const [flags, setFlags] = React.useState<FlagRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [overrideOpen, setOverrideOpen] = React.useState<FlagRow | null>(null);
  const [overridesListOpen, setOverridesListOpen] = React.useState<FlagRow | null>(null);
  const [overrides, setOverrides] = React.useState<
    { businessId: string; businessName: string; enabled: boolean }[]
  >([]);
  const [overridesLoading, setOverridesLoading] = React.useState(false);
  const [editFlag, setEditFlag] = React.useState<FlagRow | null>(null);
  const [editForm, setEditForm] = React.useState({ name: "", description: "" });
  const [overrideBiz, setOverrideBiz] = React.useState("");
  const [overrideEnabled, setOverrideEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ key: "", name: "", description: "", enabled: false });
  const [deleteKey, setDeleteKey] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/feature-flags", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setFlags(data.flags || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function loadOverrides(flag: FlagRow) {
    setOverridesListOpen(flag);
    setOverridesLoading(true);
    try {
      const res = await fetch(`/api/super-admin/feature-flags/${flag.key}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setOverrides(data.overrides || []);
    } catch {
      toast.error("Failed to load overrides");
      setOverrides([]);
    } finally {
      setOverridesLoading(false);
    }
  }

  async function removeOverride(flagKey: string, businessId: string) {
    try {
      const res = await fetch(
        `/api/super-admin/feature-flags/${flagKey}?businessId=${businessId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed");
      setOverrides((prev) => prev.filter((o) => o.businessId !== businessId));
      load();
      toast.success("Override removed");
    } catch {
      toast.error("Failed to remove override");
    }
  }

  async function saveFlagEdit() {
    if (!editFlag) return;
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: editFlag.key,
          name: editForm.name.trim(),
          description: editForm.description.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Flag updated");
      setEditFlag(null);
      load();
    } catch {
      toast.error("Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleGlobal(flag: FlagRow) {
    try {
      const res = await fetch("/api/super-admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: flag.key, enabled: !flag.enabled }),
      });
      if (!res.ok) throw new Error("Failed");
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: !f.enabled } : f)));
    } catch {
      toast.error("Toggle failed");
    }
  }

  async function createFlag() {
    if (!form.key.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed");
      }
      toast.success("Feature flag created");
      setCreateOpen(false);
      setForm({ key: "", name: "", description: "", enabled: false });
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveOverride() {
    if (!overrideOpen || !overrideBiz) return;
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: overrideBiz,
          flagKey: overrideOpen.key,
          enabled: overrideEnabled,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Tenant override saved");
      setOverrideOpen(null);
      load();
    } catch {
      toast.error("Override failed");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteKey) return;
    try {
      await fetch(`/api/super-admin/feature-flags/${deleteKey}`, { method: "DELETE" });
      setFlags((prev) => prev.filter((f) => f.key !== deleteKey));
      setDeleteKey(null);
      toast.success("Flag deleted");
    } catch {
      toast.error("Delete failed");
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Flag className="h-4 w-4" /> Feature Flags
            </CardTitle>
            <CardDescription>Control rollout of platform features globally or per tenant.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New Flag
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-6 pb-6 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Flag</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Global</TableHead>
                  <TableHead>Overrides</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="pl-6">
                      <div className="text-sm font-medium">{f.name}</div>
                      {f.description && <div className="text-xs text-muted-foreground">{f.description}</div>}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{f.key}</code>
                    </TableCell>
                    <TableCell>
                      <Switch checked={f.enabled} onCheckedChange={() => toggleGlobal(f)} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {f.overrideCount > 0 ? (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 tabular-nums"
                          onClick={() => loadOverrides(f)}
                        >
                          {f.overrideCount}
                        </Button>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => {
                          setEditFlag(f);
                          setEditForm({ name: f.name, description: f.description || "" });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => {
                          setOverrideOpen(f);
                          setOverrideBiz(businesses[0]?.id || "");
                          setOverrideEnabled(true);
                        }}
                      >
                        <ToggleLeft className="h-3.5 w-3.5" /> Override
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteKey(f.key)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Feature Flag</DialogTitle>
            <DialogDescription>Use snake_case keys (e.g. whatsapp_live).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Key</Label>
              <Input placeholder="my_feature" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label>Enabled globally</Label>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={createFlag} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overrideOpen} onOpenChange={(o) => !o && setOverrideOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tenant Override — {overrideOpen?.name}</DialogTitle>
            <DialogDescription>Override the global default for a specific tenant.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tenant</Label>
              <Select value={overrideBiz} onValueChange={setOverrideBiz}>
                <SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger>
                <SelectContent>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label>Enabled for this tenant</Label>
              <Switch checked={overrideEnabled} onCheckedChange={setOverrideEnabled} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveOverride} disabled={saving || !overrideBiz}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overridesListOpen} onOpenChange={(o) => !o && setOverridesListOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Overrides — {overridesListOpen?.name}</DialogTitle>
            <DialogDescription>Tenant-specific overrides for this flag.</DialogDescription>
          </DialogHeader>
          {overridesLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : overrides.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No overrides.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {overrides.map((o) => (
                <div key={o.businessId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{o.businessName}</div>
                    <div className="text-xs text-muted-foreground">
                      {o.enabled ? "Enabled" : "Disabled"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive h-8"
                    onClick={() =>
                      overridesListOpen &&
                      removeOverride(overridesListOpen.key, o.businessId)
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editFlag} onOpenChange={(o) => !o && setEditFlag(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Flag — {editFlag?.key}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFlag(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveFlagEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteKey} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete flag {deleteKey}?</AlertDialogTitle>
            <AlertDialogDescription>All tenant overrides for this flag will also be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function exportTenantsCsv() {
  window.open("/api/super-admin/businesses/export", "_blank");
}

function PlatformSecurityPanel() {
  const [profile, setProfile] = React.useState<{
    email: string;
    totpEnabled: boolean;
    isPlatformAdmin: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [setup, setSetup] = React.useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [disablePassword, setDisablePassword] = React.useState("");
  const [disableCode, setDisableCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [enforce2fa, setEnforce2fa] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const [meRes, cfgRes] = await Promise.all([
        fetch("/api/platform-auth/me", { cache: "no-store" }),
        fetch("/api/super-admin/platform-config", { cache: "no-store" }),
      ]);
      const data = await meRes.json();
      const cfg = await cfgRes.json().catch(() => ({}));
      setEnforce2fa(!!cfg?.config?.enforcePlatform2fa);
      if (data.admin) {
        setProfile({
          email: data.admin.email,
          totpEnabled: data.admin.totpEnabled,
          isPlatformAdmin: true,
        });
      } else {
        setProfile(null);
      }
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function beginSetup() {
    setBusy(true);
    try {
      const res = await fetch("/api/platform-auth/totp/setup");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed");
      setSetup(data);
      toast.success("Scan the secret in your authenticator app");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    if (!verifyCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/platform-auth/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      toast.success("2FA enabled");
      setSetup(null);
      setVerifyCode("");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function disable2fa() {
    setBusy(true);
    try {
      const res = await fetch("/api/platform-auth/totp/setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("2FA disabled");
      setDisablePassword("");
      setDisableCode("");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!profile?.isPlatformAdmin) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Platform security settings require signing in via{" "}
          <strong>Platform admin sign in</strong> (dedicated auth realm).
          Legacy tenant super-admin accounts should migrate to platform login.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" /> Platform Security
        </CardTitle>
        <CardDescription>
          Two-factor authentication for platform admin accounts ({profile.email}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Two-factor authentication (TOTP)</div>
              <div className="text-xs text-muted-foreground">
                {profile.totpEnabled ? "Enabled — required at platform login" : "Not enabled"}
              </div>
            </div>
            <Badge variant={profile.totpEnabled ? "default" : "secondary"}>
              {profile.totpEnabled ? "On" : "Off"}
            </Badge>
          </div>

          {!profile.totpEnabled && !setup && (
            <Button size="sm" onClick={beginSetup} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <KeyRound className="h-4 w-4" /> Enable 2FA
            </Button>
          )}

          {setup && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Add this secret to Google Authenticator, Authy, or 1Password, then enter the 6-digit code.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all flex-1">
                  {setup.secret}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(setup.secret);
                    toast.success("Secret copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground break-all">{setup.otpauthUrl}</p>
              <div className="flex gap-2">
                <Input
                  placeholder="6-digit code"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  className="max-w-[160px]"
                />
                <Button onClick={confirmSetup} disabled={busy || verifyCode.length < 6}>
                  Confirm
                </Button>
              </div>
            </div>
          )}

          {profile.totpEnabled && (
            <div className="space-y-2 pt-2 border-t">
              {enforce2fa ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Platform policy requires 2FA for all admins. Turn off enforcement in
                  Platform Settings → General before disabling.
                </p>
              ) : (
                <>
                  <Label className="text-xs">Disable 2FA (password + current code required)</Label>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                  />
                  <Input
                    placeholder="Current 2FA code"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={disable2fa}
                    disabled={busy || !disablePassword || disableCode.length < 6}
                  >
                    Disable 2FA
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Payment webhook verification</p>
          <p>
            Set <code>PAYSTACK_SECRET_KEY</code> and <code>FLUTTERWAVE_SECRET_HASH</code> in production.
            Unsigned webhooks are rejected when secrets are configured.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
