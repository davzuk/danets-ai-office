"use client";

// Proactive messages (Phase 2, workstream O): rules that make the website
// widget speak first. Each rule saves on its own, separately from the agent
// form, through /api/widget-rules.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, Megaphone, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type PageMatch = "contains" | "equals" | "prefix";
type Trigger = "load" | "time" | "scroll" | "exit";

interface RuleConditions {
  pages: { match: PageMatch; value: string }[];
  trigger: Trigger;
  seconds?: number;
  scrollPercent?: number;
  visitor: "any" | "new" | "returning";
  devices: ("desktop" | "mobile")[];
}

interface WidgetRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RuleConditions;
  message: string;
  quickReplies: string[] | null;
  action: "bubble" | "open" | "booking";
  frequency: "session" | "day" | "once";
  shows: number;
  chats: number;
  leads: number;
}

type Draft = Omit<WidgetRule, "id" | "shows" | "chats" | "leads" | "quickReplies"> & { id?: string; quickReplies: string[] };

const NEW_DRAFT: Draft = {
  name: "",
  enabled: true,
  priority: 0,
  conditions: { pages: [], trigger: "time", seconds: 15, visitor: "any", devices: ["desktop", "mobile"] },
  message: "",
  quickReplies: [],
  action: "bubble",
  frequency: "session",
};

const TRIGGER_LABEL: Record<Trigger, string> = {
  load: "As soon as the page loads",
  time: "After some time on the page",
  scroll: "After scrolling down the page",
  exit: "When the visitor is about to leave",
};

function describe(r: WidgetRule): string {
  const c = r.conditions;
  const when =
    c.trigger === "time" ? `after ${c.seconds ?? 15}s` : c.trigger === "scroll" ? `at ${c.scrollPercent ?? 50}% scroll` : c.trigger === "exit" ? "on exit intent" : "on load";
  // Wildcards read as "anything here": /blog* starts with, *pricing* contains.
  const where = c.pages.length === 0 ? "every page" : c.pages.map((p) => (p.match === "equals" ? p.value : p.match === "prefix" ? `${p.value}*` : `*${p.value}*`)).join(", ");
  const who = c.visitor === "any" ? "" : c.visitor === "new" ? ", new visitors" : ", returning visitors";
  const device = c.devices.length === 1 ? `, ${c.devices[0]} only` : "";
  return `${where}, ${when}${who}${device}`;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export function ProactiveMessagesPanel({ brandColor }: { brandColor: string }) {
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [rules, setRules] = useState<WidgetRule[]>([]);
  const [max, setMax] = useState(20);
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<WidgetRule | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/widget-rules");
      const data = await res.json();
      if (res.status === 403) {
        setLocked(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not load proactive messages.");
      setLocked(false);
      setRules(data.rules);
      setMax(data.max);
      setCanEdit(data.canEdit);
    } catch (e: any) {
      toast.error(e.message || "Could not load proactive messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the first load's state updates land outside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function toggle(rule: WidgetRule, enabled: boolean) {
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    const res = await fetch(`/api/widget-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Could not update the message.");
    }
  }

  async function saveDraft(resetStats = false) {
    if (!draft) return;
    setSaving(true);
    try {
      const { id, ...input } = draft;
      const body = {
        ...input,
        name: input.name.trim(),
        message: input.message.trim(),
        quickReplies: input.quickReplies.map((q) => q.trim()).filter(Boolean),
        conditions: { ...input.conditions, pages: input.conditions.pages.filter((p) => p.value.trim()) },
        ...(id && resetStats ? { resetStats: true } : {}),
      };
      const res = await fetch(id ? `/api/widget-rules/${id}` : "/api/widget-rules", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the message.");
      toast.success(id ? "Proactive message updated." : "Proactive message created.");
      setDraft(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Could not save the message.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/widget-rules/${deleting.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Proactive message deleted.");
      setRules((rs) => rs.filter((r) => r.id !== deleting.id));
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Could not delete the message.");
    }
    setDeleting(null);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (locked) {
    return (
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <CardTitle className="text-base">Proactive messages are on the Starter plan and above</CardTitle>
          <CardDescription>
            Greet visitors on chosen pages, after a delay, on scroll or when they are about to leave. Upgrade from Billing to turn this on.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (draft) {
    return <RuleEditor draft={draft} setDraft={setDraft} saving={saving} onSave={saveDraft} brandColor={brandColor} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-accent-foreground" />
            Proactive messages
          </CardTitle>
          <CardDescription>
            Let the widget speak first. Visitors see at most one message per page, the highest-priority one that matches. Changes here save straight away.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setDraft(structuredClone(NEW_DRAFT))} disabled={rules.length >= max}>
            <Plus className="h-4 w-4" />
            New message
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
            No proactive messages yet. {canEdit ? "Create one to greet visitors on your pricing or contact page." : "Ask an admin to create one."}
          </p>
        ) : (
          rules.map((r) => (
            <div key={r.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{r.name}</span>
                    {r.priority !== 0 && <Badge variant="outline">Priority {r.priority}</Badge>}
                    {r.action === "open" && <Badge variant="secondary">Opens chat</Badge>}
                    {r.action === "booking" && <Badge variant="secondary">Offers booking</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{describe(r)}</p>
                  <p className="text-sm line-clamp-2">&ldquo;{r.message}&rdquo;</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${r.name}`}
                        onClick={() =>
                          setDraft({
                            id: r.id,
                            name: r.name,
                            enabled: r.enabled,
                            priority: r.priority,
                            conditions: structuredClone(r.conditions),
                            message: r.message,
                            quickReplies: [...(r.quickReplies ?? [])],
                            action: r.action,
                            frequency: r.frequency,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <Switch checked={r.enabled} disabled={!canEdit} onCheckedChange={(v) => toggle(r, v)} aria-label={`Turn ${r.name} ${r.enabled ? "off" : "on"}`} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Shown" value={r.shows} />
                <Stat label="Chats" value={r.chats} sub={pct(r.chats, r.shows)} />
                <Stat label="Leads" value={r.leads} sub={pct(r.leads, r.chats)} />
              </div>
            </div>
          ))
        )}
        {rules.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {rules.length}/{max} used. &ldquo;Shown&rdquo; counts a visitor once per 30 minutes; chats and leads count conversations started from the message.
          </p>
        )}
      </CardContent>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleting?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>The message stops showing on your website and its stats are removed. Conversations it started are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-md bg-muted/50 py-1.5">
      <div className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground">
        {label}
        {sub && sub !== "–" ? ` · ${sub}` : ""}
      </div>
    </div>
  );
}

function RuleEditor({
  draft,
  setDraft,
  saving,
  onSave,
  brandColor,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  saving: boolean;
  onSave: (resetStats?: boolean) => void;
  brandColor: string;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setCond = <K extends keyof RuleConditions>(k: K, v: RuleConditions[K]) => setDraft({ ...draft, conditions: { ...draft.conditions, [k]: v } });
  const c = draft.conditions;
  const [resetStats, setResetStats] = useState(false);
  const valid = draft.name.trim().length > 0 && draft.message.trim().length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{draft.id ? "Edit proactive message" : "New proactive message"}</CardTitle>
          <CardDescription>Choose where and when it appears, then write what the widget says.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close editor" onClick={() => setDraft(null)}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div className="space-y-1.5">
            <Label htmlFor="pm-name" className="text-xs">Name (only you see this)</Label>
            <Input id="pm-name" value={draft.name} maxLength={80} placeholder="Pricing page nudge" onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-priority" className="text-xs">Priority</Label>
            <Input
              id="pm-priority"
              type="number"
              min={-100}
              max={100}
              value={draft.priority}
              onChange={(e) => set("priority", Math.max(-100, Math.min(100, Math.round(Number(e.target.value) || 0))))}
            />
          </div>
        </div>

        <section className="space-y-2">
          <Label className="text-xs">Pages</Label>
          {c.pages.length === 0 && <p className="text-xs text-muted-foreground">Shows on every page. Add a rule to limit it.</p>}
          {c.pages.map((p, i) => (
            <div key={i} className="flex gap-2">
              <Select
                value={p.match}
                onValueChange={(v) => setCond("pages", c.pages.map((x, j) => (j === i ? { ...x, match: v as PageMatch } : x)))}
              >
                <SelectTrigger className="w-[150px]" aria-label="How to match the page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">URL contains</SelectItem>
                  <SelectItem value="prefix">URL starts with</SelectItem>
                  <SelectItem value="equals">URL is exactly</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={p.value}
                maxLength={300}
                placeholder={p.match === "contains" ? "pricing" : "/pricing"}
                aria-label="Page path"
                onChange={(e) => setCond("pages", c.pages.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <Button variant="ghost" size="icon" aria-label="Remove page rule" onClick={() => setCond("pages", c.pages.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {c.pages.length < 20 && (
            <Button variant="outline" size="sm" onClick={() => setCond("pages", [...c.pages, { match: "contains", value: "" }])}>
              <Plus className="h-4 w-4" />
              Add page rule
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Matched against the path, e.g. /pricing, ignoring letter case. A page matching any rule counts.</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">When</Label>
            <Select
              value={c.trigger}
              onValueChange={(v) =>
                setDraft({
                  ...draft,
                  conditions: {
                    ...c,
                    trigger: v as Trigger,
                    seconds: v === "time" ? (c.seconds ?? 15) : undefined,
                    scrollPercent: v === "scroll" ? (c.scrollPercent ?? 50) : undefined,
                  },
                })
              }
            >
              <SelectTrigger aria-label="When to show">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TRIGGER_LABEL) as Trigger[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {c.trigger === "time" && (
            <div className="space-y-1.5">
              <Label htmlFor="pm-seconds" className="text-xs">Seconds on the page</Label>
              <Input id="pm-seconds" type="number" min={0} max={600} value={c.seconds ?? 15} onChange={(e) => setCond("seconds", Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))))} />
            </div>
          )}
          {c.trigger === "scroll" && (
            <div className="space-y-1.5">
              <Label htmlFor="pm-scroll" className="text-xs">Percent of the page scrolled</Label>
              <Input id="pm-scroll" type="number" min={5} max={100} value={c.scrollPercent ?? 50} onChange={(e) => setCond("scrollPercent", Math.max(5, Math.min(100, Math.round(Number(e.target.value) || 50))))} />
            </div>
          )}
          {c.trigger === "exit" && (
            <p className="text-xs text-muted-foreground self-end">
              On computers: when the pointer leaves towards the browser tabs. On phones: a fast scroll back up after 15 seconds.
            </p>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Visitors</Label>
            <Select value={c.visitor} onValueChange={(v) => setCond("visitor", v as RuleConditions["visitor"])}>
              <SelectTrigger aria-label="Which visitors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Everyone</SelectItem>
                <SelectItem value="new">First visit only</SelectItem>
                <SelectItem value="returning">Returning visitors only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Devices</Label>
            <Select
              value={c.devices.length === 2 ? "both" : c.devices[0]}
              onValueChange={(v) => setCond("devices", v === "both" ? ["desktop", "mobile"] : [v as "desktop" | "mobile"])}
            >
              <SelectTrigger aria-label="Which devices">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Computers and phones</SelectItem>
                <SelectItem value="desktop">Computers only</SelectItem>
                <SelectItem value="mobile">Phones and tablets only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">How it appears</Label>
            <Select value={draft.action} onValueChange={(v) => set("action", v as Draft["action"])}>
              <SelectTrigger aria-label="How it appears">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bubble">Speech bubble by the chat button</SelectItem>
                <SelectItem value="open">Open the chat window</SelectItem>
                <SelectItem value="booking">Bubble that offers booking times</SelectItem>
              </SelectContent>
            </Select>
            {draft.action === "open" && <p className="text-xs text-muted-foreground">Phones always get the bubble, so the chat never covers the page.</p>}
            {draft.action === "booking" && (
              <p className="text-xs text-muted-foreground">Opening the chat shows your next free times. Needs an active booking type (Leads → Bookings); without one it acts as a plain bubble.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">How often</Label>
            <Select value={draft.frequency} onValueChange={(v) => set("frequency", v as Draft["frequency"])}>
              <SelectTrigger aria-label="How often">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="session">Once per visit</SelectItem>
                <SelectItem value="day">At most once a day</SelectItem>
                <SelectItem value="once">Only once, ever</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="space-y-2">
          <Label htmlFor="pm-message" className="text-xs">Message</Label>
          <Textarea id="pm-message" rows={3} maxLength={300} value={draft.message} placeholder="Questions about plans? I can help you pick the right one." onChange={(e) => set("message", e.target.value)} />
          <p className="text-xs text-muted-foreground text-right">{draft.message.length}/300</p>
          <Label className="text-xs">Quick replies (optional, up to 4)</Label>
          {draft.quickReplies.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input value={q} maxLength={60} aria-label={`Quick reply ${i + 1}`} onChange={(e) => set("quickReplies", draft.quickReplies.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button variant="ghost" size="icon" aria-label="Remove quick reply" onClick={() => set("quickReplies", draft.quickReplies.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {draft.quickReplies.length < 4 && (
            <Button variant="outline" size="sm" onClick={() => set("quickReplies", [...draft.quickReplies, ""])}>
              <Plus className="h-4 w-4" />
              Add quick reply
            </Button>
          )}
        </section>

        <section className="space-y-2">
          <Label className="text-xs">Preview</Label>
          <div className="rounded-lg border bg-muted/40 p-4 flex flex-col items-end gap-2">
            <div className="relative max-w-[260px] rounded-xl border bg-background px-3 py-2 text-sm shadow-sm">
              {draft.message.trim() || "Your message appears here."}
            </div>
            {draft.quickReplies.some((q) => q.trim()) && (
              <div className="flex flex-wrap justify-end gap-1.5 max-w-[260px]">
                {draft.quickReplies.filter((q) => q.trim()).map((q, i) => (
                  <span key={i} className="rounded-full border bg-background px-2.5 py-0.5 text-xs" style={{ borderColor: brandColor, color: brandColor }}>
                    {q}
                  </span>
                ))}
              </div>
            )}
            <div className="h-12 w-12 rounded-full shadow" style={{ backgroundColor: brandColor }} aria-hidden />
          </div>
          <p className="text-xs text-muted-foreground">Quick replies show once the visitor opens the chat.</p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
              {draft.enabled ? "On" : "Off"}
            </label>
            {draft.id && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={resetStats} onCheckedChange={setResetStats} />
                <RotateCcw className="h-3.5 w-3.5" />
                Reset stats
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => onSave(resetStats)} disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {draft.id ? "Save message" : "Create message"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
