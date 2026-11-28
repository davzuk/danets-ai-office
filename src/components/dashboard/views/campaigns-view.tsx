"use client";

// Campaigns (Phase 4). Workstream AA: campaign records, linked items and
// the touches matched to each campaign.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Megaphone, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CAMPAIGN_GOALS, GOAL_LABELS, STATUS_LABELS, TENANT_ASSET_TYPES, campaignSlug, type AssetType, type CampaignStatus } from "@/lib/campaigns/rules";
import { leadSourceLabel } from "@/lib/channel-meta";
import { invalidateCampaignOptions } from "./campaign-select";
import { cn } from "@/lib/utils";

interface Campaign {
  id: string;
  name: string;
  slug: string;
  goal: string;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  budget: number | null;
  targetLeads: number | null;
  ownerId: string | null;
  notes: string | null;
  aliases: string[];
  updatedAt: string;
  counts: { touches: number; leads: number; assets: number };
}

interface AssetRow {
  type: AssetType;
  id: string;
  name: string;
  status: string;
  campaignId: string | null;
}

interface Detail {
  campaign: Campaign;
  assets: { linked: AssetRow[]; available: AssetRow[] };
  touchesByKind: Record<string, number>;
  touchesByChannel: Record<string, number>;
  canDelete: boolean;
}

async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

const ASSET_LABELS: Record<AssetType, string> = { post: "Post", form: "Form", magnet: "Lead magnet", booking_type: "Booking page", page: "Website page" };
const KIND_LABELS: Record<string, string> = {
  visit: "Site visits",
  chat_start: "Chats started",
  form_submit: "Form submissions",
  ad_lead: "Ad leads",
  social_dm: "Social messages",
  email_click: "Email clicks",
  booking: "Bookings",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ended: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  archived: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={cn("border-0 font-medium", STATUS_STYLES[status])}>{STATUS_LABELS[status as CampaignStatus] ?? status}</Badge>;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : null);
const fmtMoney = (n: number | null) => (n == null ? null : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function dateRange(c: Pick<Campaign, "startsAt" | "endsAt">) {
  const s = fmtDate(c.startsAt);
  const e = fmtDate(c.endsAt);
  if (s && e) return `${s} – ${e}`;
  if (s) return `From ${s}`;
  if (e) return `Until ${e}`;
  return "No dates";
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

export function CampaignsView() {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <CampaignPage id={openId} onBack={() => setOpenId(null)} /> : <CampaignList onOpen={setOpenId} />;
}

// ─── List ─────────────────────────────────────────────────────────────

function CampaignList({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<{ campaigns: Campaign[]; limit: { used: number; limit: number } } | null>(null);
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/campaigns${archived ? "?archived=1" : ""}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [archived]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const full = !!data && data.limit.limit > 0 && data.limit.used >= data.limit.limit;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Group the posts, forms, lead magnets and booking pages of one marketing push, and see the leads it brings in.</p>
        </div>
        <div className="flex items-center gap-3">
          {data ? (
            <span className="text-xs text-muted-foreground">
              {data.limit.limit > 0 ? `${data.limit.used} of ${data.limit.limit} open campaigns` : `${data.limit.used} open campaigns`}
            </span>
          ) : null}
          <Button onClick={() => setCreating(true)} disabled={full} title={full ? "End or archive a campaign, or upgrade, to add another." : undefined}>
            <Plus className="mr-2 h-4 w-4" />
            New campaign
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="show-archived" checked={archived} onCheckedChange={setArchived} />
        <Label htmlFor="show-archived" className="text-sm font-normal">
          Show archived
        </Label>
      </div>

      {!data ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : data.campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No campaigns yet</p>
              <p className="text-sm text-muted-foreground">Create one for your next offer, event or season, then add its posts and forms.</p>
            </div>
            <Button onClick={() => setCreating(true)} disabled={full}>
              <Plus className="mr-2 h-4 w-4" />
              New campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.campaigns.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {GOAL_LABELS[c.goal as keyof typeof GOAL_LABELS] ?? c.goal} · {dateRange(c)}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Leads" value={c.counts.leads} sub={c.targetLeads ? `of ${c.targetLeads}` : undefined} />
                <Stat label="Touches" value={c.counts.touches} />
                <Stat label="Items" value={c.counts.assets} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Mounted only while open, so every new campaign starts with an empty form. */}
      {creating ? (
      <CreateDialog
        open
        onOpenChange={setCreating}
        onCreated={(c) => {
          invalidateCampaignOptions();
          setCreating(false);
          onOpen(c.id);
        }}
      />
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2">
      <p className="text-lg font-semibold tabular-nums">
        {value}
        {sub ? <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span> : null}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (c: Campaign) => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<string>("leads");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [budget, setBudget] = useState("");
  const [targetLeads, setTargetLeads] = useState("");
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const d = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        json: {
          name,
          goal,
          status: activate ? "active" : "draft",
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          budget: budget === "" ? null : Number(budget),
          targetLeads: targetLeads === "" ? null : Number(targetLeads),
        },
      });
      toast.success("Campaign created");
      onCreated(d.campaign);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>You can add posts, forms and booking pages to it next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="e.g. Spring sale" autoFocus />
            {campaignSlug(name) ? <p className="text-xs text-muted-foreground">Tracking name: {campaignSlug(name)}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-goal">Goal</Label>
            <Select value={goal} onValueChange={setGoal}>
              <SelectTrigger id="c-goal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_GOALS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {GOAL_LABELS[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-start">Starts</Label>
              <Input id="c-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-end">Ends</Label>
              <Input id="c-end" type="date" value={endsAt} min={startsAt || undefined} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-budget">Budget (optional)</Label>
              <Input id="c-budget" type="number" min={0} step="0.01" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-target">Lead target (optional)</Label>
              <Input id="c-target" type="number" min={0} step={1} inputMode="numeric" value={targetLeads} onChange={(e) => setTargetLeads(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="c-activate" checked={activate} onCheckedChange={setActivate} />
            <Label htmlFor="c-activate" className="text-sm font-normal">
              Start now (a draft campaign&apos;s posts can&apos;t be scheduled yet)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || name.trim().length < 2}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── One campaign ─────────────────────────────────────────────────────

function CampaignPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"overview" | "assets" | "settings">("overview");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/campaigns/${id}`));
    } catch (e: any) {
      toast.error(e.message);
      onBack();
    }
  }, [id, onBack]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function setStatus(status: CampaignStatus, message: string) {
    setBusy(status);
    try {
      const d = await api<{ campaign: Campaign }>(`/api/campaigns/${id}`, { method: "PATCH", json: { status } });
      setData((prev) => (prev ? { ...prev, campaign: { ...d.campaign, counts: prev.campaign.counts } } : prev));
      invalidateCampaignOptions();
      toast.success(message);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  const c = data.campaign;

  const actions: { status: CampaignStatus; label: string; message: string; variant?: "outline" }[] =
    c.status === "draft"
      ? [{ status: "active", label: "Start campaign", message: "Campaign started" }]
      : c.status === "active"
        ? [
            { status: "paused", label: "Pause", message: "Campaign paused", variant: "outline" },
            { status: "ended", label: "End", message: "Campaign ended", variant: "outline" },
          ]
        : c.status === "paused"
          ? [
              { status: "active", label: "Resume", message: "Campaign resumed" },
              { status: "ended", label: "End", message: "Campaign ended", variant: "outline" },
            ]
          : c.status === "ended"
            ? [
                { status: "active", label: "Reopen", message: "Campaign reopened", variant: "outline" },
                { status: "archived", label: "Archive", message: "Campaign archived", variant: "outline" },
              ]
            : [{ status: "ended", label: "Restore", message: "Campaign restored", variant: "outline" }];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" />
          All campaigns
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold">{c.name}</h1>
              <StatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {GOAL_LABELS[c.goal as keyof typeof GOAL_LABELS] ?? c.goal} · {dateRange(c)} · tracking name <code className="rounded bg-muted px-1 text-xs">{c.slug}</code>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.status} size="sm" variant={a.variant} onClick={() => setStatus(a.status, a.message)} disabled={!!busy}>
                {busy === a.status ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="inline-flex items-center gap-1 rounded-lg border p-0.5">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "assets"} onClick={() => setTab("assets")}>
          Linked items
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          Settings
        </TabButton>
      </div>

      {tab === "overview" ? (
        <Overview data={data} />
      ) : tab === "assets" ? (
        <Assets campaignId={c.id} archived={c.status === "archived"} assets={data.assets} onChange={(assets) => setData((prev) => (prev ? { ...prev, assets, campaign: { ...prev.campaign, counts: { ...prev.campaign.counts, assets: assets.linked.length } } } : prev))} />
      ) : (
        <SettingsTab
          campaign={c}
          canDelete={data.canDelete}
          onSaved={() => {
            invalidateCampaignOptions();
            // New names can link earlier visits, so fetch fresh counts.
            load();
          }}
          onDeleted={() => {
            invalidateCampaignOptions();
            onBack();
          }}
        />
      )}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">{r.value}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Overview({ data }: { data: Detail }) {
  const c = data.campaign;
  const kinds = Object.entries(data.touchesByKind)
    .map(([k, v]) => ({ label: KIND_LABELS[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value);
  const channels = Object.entries(data.touchesByChannel)
    .map(([k, v]) => ({ label: leadSourceLabel(k), value: v }))
    .sort((a, b) => b.value - a.value);
  const progress = c.targetLeads ? Math.min(100, Math.round((c.counts.leads / c.targetLeads) * 100)) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Leads" value={c.counts.leads} hint="Leads whose last touch was this campaign" />
        <Tile label="Touches" value={c.counts.touches} hint="Visits, chats, form submissions and bookings" />
        <Tile label="Linked items" value={c.counts.assets} />
        <Tile label="Budget" value={fmtMoney(c.budget) ?? "—"} hint={c.budget == null ? "Not set" : undefined} />
      </div>
      {progress != null ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex justify-between text-sm">
              <span>Lead target</span>
              <span className="tabular-nums text-muted-foreground">
                {c.counts.leads} of {c.targetLeads} ({progress}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          </CardContent>
        </Card>
      ) : null}
      {c.counts.touches === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nothing has come in yet. Add posts, forms or booking pages under <strong>Linked items</strong>, or use the tracking name{" "}
            <code className="rounded bg-muted px-1 text-xs">utm_campaign={c.slug}</code> in your own links.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Breakdown title="What came in" rows={kinds} />
          <Breakdown title="By channel" rows={channels} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function Assets({ campaignId, archived, assets, onChange }: { campaignId: string; archived: boolean; assets: Detail["assets"]; onChange: (a: Detail["assets"]) => void }) {
  const [type, setType] = useState<AssetType>("post");
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const choices = useMemo(() => assets.available.filter((a) => a.type === type), [assets.available, type]);

  async function link(row: { type: AssetType; id: string }, linked: boolean) {
    setBusy(`${row.type}:${row.id}`);
    try {
      const d = await api<{ assets: Detail["assets"] }>(`/api/campaigns/${campaignId}/assets`, { method: "POST", json: { type: row.type, id: row.id, linked } });
      onChange(d.assets);
      setPick("");
      toast.success(linked ? "Added to the campaign" : "Removed from the campaign");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  const chosen = choices.find((c) => c.id === pick);

  return (
    <div className="space-y-4">
      {!archived ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add an item</CardTitle>
            <CardDescription>Posts get the campaign&apos;s tracking name in their links. Forms, lead magnets and booking pages count every submission and booking toward the campaign.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as AssetType);
                setPick("");
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Item type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TENANT_ASSET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ASSET_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={pick} onValueChange={setPick} disabled={choices.length === 0}>
              <SelectTrigger className="w-full min-w-0 flex-1" aria-label="Item">
                <SelectValue placeholder={choices.length === 0 ? `No ${ASSET_LABELS[type].toLowerCase()}s to add` : "Choose…"} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.campaignId ? " (in another campaign)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => chosen && link(chosen, true)} disabled={!chosen || !!busy}>
              {busy && chosen && busy === `${chosen.type}:${chosen.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">In this campaign</CardTitle>
          <CardDescription>Website pages are added by the platform team when they build a page for the campaign.</CardDescription>
        </CardHeader>
        <CardContent>
          {assets.linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing linked yet.</p>
          ) : (
            <ul className="divide-y">
              {assets.linked.map((a) => (
                <li key={`${a.type}:${a.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ASSET_LABELS[a.type]} · {a.status.replace("_", " ")}
                    </p>
                  </div>
                  {a.type !== "page" ? (
                    <Button variant="ghost" size="icon" aria-label={`Remove ${a.name}`} onClick={() => link(a, false)} disabled={!!busy}>
                      {busy === `${a.type}:${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ campaign, canDelete, onSaved, onDeleted }: { campaign: Campaign; canDelete: boolean; onSaved: (c: Campaign) => void; onDeleted: () => void }) {
  const [form, setForm] = useState(() => ({
    name: campaign.name,
    slug: campaign.slug,
    goal: campaign.goal,
    startsAt: dateInput(campaign.startsAt),
    endsAt: dateInput(campaign.endsAt),
    budget: campaign.budget == null ? "" : String(campaign.budget),
    targetLeads: campaign.targetLeads == null ? "" : String(campaign.targetLeads),
    ownerId: campaign.ownerId ?? "",
    notes: campaign.notes ?? "",
    aliases: campaign.aliases.join(", "),
  }));
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetch("/api/team", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers((d.members ?? []).map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))))
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    try {
      const d = await api<{ campaign: Campaign }>(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        json: {
          name: form.name,
          slug: form.slug,
          goal: form.goal,
          startsAt: form.startsAt || null,
          endsAt: form.endsAt || null,
          budget: form.budget === "" ? null : Number(form.budget),
          targetLeads: form.targetLeads === "" ? null : Number(form.targetLeads),
          ownerId: form.ownerId || null,
          notes: form.notes || null,
          aliases: form.aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        },
      });
      setForm((f) => ({ ...f, slug: d.campaign.slug, aliases: d.campaign.aliases.join(", ") }));
      onSaved(d.campaign);
      toast.success("Campaign saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      toast.success("Campaign deleted");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  }

  const slugPreview = campaignSlug(form.slug);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" value={form.name} onChange={(e) => set("name")(e.target.value)} maxLength={160} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-goal">Goal</Label>
            <Select value={form.goal} onValueChange={set("goal")}>
              <SelectTrigger id="s-goal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_GOALS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {GOAL_LABELS[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-owner">Owner</Label>
            <Select value={form.ownerId || "__none__"} onValueChange={(v) => set("ownerId")(v === "__none__" ? "" : v)}>
              <SelectTrigger id="s-owner" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No owner</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-start">Starts</Label>
            <Input id="s-start" type="date" value={form.startsAt} onChange={(e) => set("startsAt")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-end">Ends</Label>
            <Input id="s-end" type="date" value={form.endsAt} min={form.startsAt || undefined} onChange={(e) => set("endsAt")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-budget">Budget</Label>
            <Input id="s-budget" type="number" min={0} step="0.01" inputMode="decimal" value={form.budget} onChange={(e) => set("budget")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-target">Lead target</Label>
            <Input id="s-target" type="number" min={0} step={1} inputMode="numeric" value={form.targetLeads} onChange={(e) => set("targetLeads")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-slug">Tracking name</Label>
            <Input id="s-slug" value={form.slug} onChange={(e) => set("slug")(e.target.value)} maxLength={80} />
            <p className="text-xs text-muted-foreground">
              Used as <code>utm_campaign</code>{slugPreview && slugPreview !== form.slug ? ` (saved as "${slugPreview}")` : ""}. If you change it, the old name keeps counting so links already out there still work.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-aliases">Other names that count</Label>
            <Input id="s-aliases" value={form.aliases} onChange={(e) => set("aliases")(e.target.value)} placeholder="e.g. spring-sale-26, Spring Sale FB" />
            <p className="text-xs text-muted-foreground">Comma-separated. Visits and ad leads tagged with any of these count toward this campaign.</p>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="s-notes">Notes</Label>
            <Textarea id="s-notes" value={form.notes} onChange={(e) => set("notes")(e.target.value)} maxLength={5000} rows={3} />
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canDelete ? (
          <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete campaign
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={save} disabled={busy || form.name.trim().length < 2}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save changes
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{campaign.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Its posts, forms and booking pages are kept but no longer belong to a campaign, and its leads stop counting toward it. This can&apos;t be undone. To keep the numbers, end or archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
