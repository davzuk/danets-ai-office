"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Hand,
  Loader2,
  RotateCcw,
  Settings2,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PLATFORM_RULES, type ContentPlatform } from "@/lib/content/platforms";
import { APPROVAL_POLICIES, APPROVAL_POLICY_LABEL, type ApprovalPolicy } from "@/lib/content/approval";
import {
  COMMON_TIMEZONES,
  formatDateTime,
  formatTime,
  moveToDay,
  parseLocalInput,
  toLocalInput,
  zonedDateKey,
  zonedParts,
  zonedToUtc,
} from "@/lib/content/timezone";
import { cn } from "@/lib/utils";
import { PlatformDot, api, errMsg } from "@/components/dashboard/views/content-shared";

// ─── Types ─────────────────────────────────────────────────────────────

export interface Schedule {
  id: string;
  postId: string;
  postTitle: string;
  postStatus: string;
  platform: ContentPlatform;
  variantId: string;
  text: string;
  mediaIds: string[];
  account: { id: string; name: string; platform: string; status: string } | null;
  scheduledFor: string;
  status: "pending_approval" | "scheduled" | "publishing" | "published" | "failed" | "cancelled" | "manual_due";
  manual: boolean;
  permalink: string | null;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
  createdById: string | null;
}

export interface PublishSettings {
  timezone: string;
  contentApproval: ApprovalPolicy;
  approvalRequired: boolean;
  teamSize: number;
  accounts: { id: string; platform: string; name: string; username: string | null; status: string; publishEnabled: boolean; lastError: string | null; usable: boolean }[];
  autoPlatforms: string[];
  canManage: boolean;
}

interface Viewer {
  userId: string;
  role: string;
}

interface SchedulablePost {
  id: string;
  title: string;
  status: string;
  variants: { platform: ContentPlatform; issues: { severity: string }[]; mediaIds: string[] }[];
}

const ACCOUNT_PLATFORM: Record<string, string> = { facebook: "facebook_page", instagram: "instagram", linkedin: "linkedin_page" };

export const SCHEDULE_STATUS: Record<Schedule["status"], { label: string; className: string; icon: typeof Clock }> = {
  pending_approval: { label: "Needs approval", className: "text-amber-700 dark:text-amber-400", icon: ShieldCheck },
  scheduled: { label: "Scheduled", className: "text-sky-700 dark:text-sky-400", icon: Clock },
  publishing: { label: "Publishing", className: "text-sky-700 dark:text-sky-400", icon: Loader2 },
  published: { label: "Published", className: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  failed: { label: "Failed", className: "text-destructive", icon: XCircle },
  cancelled: { label: "Cancelled", className: "text-muted-foreground line-through", icon: X },
  manual_due: { label: "Post by hand", className: "text-violet-700 dark:text-violet-400", icon: Hand },
};

const MOVABLE: Schedule["status"][] = ["scheduled", "pending_approval", "failed", "manual_due"];

function ScheduleStatus({ status }: { status: Schedule["status"] }) {
  const s = SCHEDULE_STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", s.className)}>
      <Icon className={cn("size-3", status === "publishing" && "animate-spin")} /> {s.label}
    </span>
  );
}

export function usePublishSettings() {
  const [settings, setSettings] = useState<PublishSettings | null>(null);
  const reload = useCallback(async () => {
    try {
      setSettings(await api<PublishSettings>("/api/scheduled-posts/settings"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { settings, setSettings, reload };
}

// ─── Actions on one schedule ───────────────────────────────────────────

/** Cancel / retry / mark posted / copy, shared by the post editor and the calendar. */
function useScheduleActions(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = useCallback(
    async (key: string, fn: () => Promise<unknown>, success: string) => {
      setBusy(key);
      try {
        await fn();
        toast.success(success);
        onChanged();
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        setBusy(null);
      }
    },
    [onChanged]
  );
  return {
    busy,
    cancel: (s: Schedule) => act(`cancel:${s.id}`, () => api(`/api/scheduled-posts/${s.id}`, { method: "DELETE" }), "Schedule cancelled"),
    retry: (s: Schedule) => act(`retry:${s.id}`, () => api(`/api/scheduled-posts/${s.id}/retry`, { method: "POST" }), "Publishing again now"),
    markPosted: (s: Schedule, permalink: string) =>
      act(`mark:${s.id}`, () => api(`/api/scheduled-posts/${s.id}/mark-posted`, { method: "POST", body: JSON.stringify({ permalink }) }), "Marked as posted"),
  };
}

function ScheduleRow({ s, tz, viewer, onChanged, onOpenPost }: { s: Schedule; tz: string; viewer: Viewer; onChanged: () => void; onOpenPost?: (id: string) => void }) {
  const { busy, cancel, retry, markPosted } = useScheduleActions(onChanged);
  const [marking, setMarking] = useState(false);
  const [link, setLink] = useState("");
  const canManage = viewer.role === "admin" || s.createdById === viewer.userId;
  const label = PLATFORM_RULES[s.platform]?.label ?? s.platform;

  async function copy() {
    try {
      await navigator.clipboard.writeText(s.text);
      toast.success(`${label} text copied`);
    } catch {
      toast.error("Couldn't copy; select the text in the post instead.");
    }
  }

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformDot platform={s.platform} />
        <div className="min-w-0 flex-1">
          {onOpenPost ? (
            <button type="button" className="truncate text-left font-medium hover:underline" onClick={() => onOpenPost(s.postId)}>
              {s.postTitle}
            </button>
          ) : (
            <span className="font-medium">{s.account ? s.account.name : `${label} (post by hand)`}</span>
          )}
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{formatDateTime(new Date(s.publishedAt ?? s.scheduledFor), tz)}</span>
            {onOpenPost && <span>{s.account ? s.account.name : "post by hand"}</span>}
            <ScheduleStatus status={s.status} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {s.permalink && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <a href={s.permalink} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> View
              </a>
            </Button>
          )}
          {(s.manual || s.status === "failed") && s.status !== "published" && s.status !== "cancelled" && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copy}>
              <Copy className="size-3.5" /> Copy text
            </Button>
          )}
          {(s.status === "manual_due" || (s.manual && s.status === "scheduled") || s.status === "failed") && (
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setMarking(true)} disabled={!!busy}>
              <CheckCircle2 className="size-3.5" /> Mark posted
            </Button>
          )}
          {s.status === "failed" && !s.manual && canManage && (
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => retry(s)} disabled={!!busy}>
              {busy === `retry:${s.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Retry
            </Button>
          )}
          {MOVABLE.includes(s.status) && canManage && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => cancel(s)} disabled={!!busy} title="Cancel this schedule">
              {busy === `cancel:${s.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
            </Button>
          )}
        </div>
      </div>
      {s.lastError && (s.status === "failed" || s.status === "scheduled") && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {s.lastError}
        </p>
      )}

      <Dialog open={marking} onOpenChange={setMarking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as posted on {label}</DialogTitle>
            <DialogDescription>Paste the link to the live post if you have it, so the team can find it later.</DialogDescription>
          </DialogHeader>
          <Input placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMarking(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await markPosted(s, link.trim());
                setMarking(false);
              }}
              disabled={busy === `mark:${s.id}`}
            >
              Mark posted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The schedules of one post, shown in the post editor. */
export function PostSchedules({ schedules, tz, viewer, onChanged }: { schedules: Schedule[]; tz: string; viewer: Viewer; onChanged: () => void }) {
  const visible = schedules.filter((s) => s.status !== "cancelled");
  if (visible.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule</h3>
      {visible.map((s) => (
        <ScheduleRow key={s.id} s={s} tz={tz} viewer={viewer} onChanged={onChanged} />
      ))}
    </div>
  );
}

// ─── Schedule dialog ───────────────────────────────────────────────────

function defaultTime(tz: string) {
  // Next full hour, at least 30 minutes away.
  const p = zonedParts(new Date(Date.now() + 90 * 60_000), tz);
  return toLocalInput(zonedToUtc(p.year, p.month, p.day, p.hour, 0, tz), tz);
}

export function ScheduleDialog({
  open,
  onOpenChange,
  post,
  settings,
  viewer,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  post: SchedulablePost;
  settings: PublishSettings | null;
  viewer: Viewer;
  onScheduled: () => void;
}) {
  const tz = settings?.timezone ?? "UTC";
  const [when, setWhen] = useState(() => defaultTime(tz));
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState(false);
  // platform → account id, "manual", or "" (not selected)
  const [choice, setChoice] = useState<Record<string, string>>({});

  const options = useMemo(() => {
    const out: Record<string, PublishSettings["accounts"]> = {};
    for (const v of post.variants) out[v.platform] = (settings?.accounts ?? []).filter((a) => a.platform === ACCOUNT_PLATFORM[v.platform]);
    return out;
  }, [post.variants, settings]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setWhen(defaultTime(tz));
      setNow(false);
      const init: Record<string, string> = {};
      for (const v of post.variants) {
        if (v.issues.some((i) => i.severity === "error")) continue;
        const usable = options[v.platform]?.find((a) => a.usable);
        init[v.platform] = usable ? usable.id : "manual";
      }
      setChoice(init);
    }, 0);
    return () => clearTimeout(t);
  }, [open, tz, post.variants, options]);

  const selected = Object.entries(choice).filter(([, v]) => v);
  const policyNote = (() => {
    if (!settings?.approvalRequired || post.status === "approved") return null;
    if (settings.contentApproval !== "always" && viewer.role === "admin") return "Scheduling approves this post.";
    return "This will wait for an admin's approval before it goes out.";
  })();
  const igNoMedia = choice.instagram && choice.instagram !== "manual" && post.variants.find((v) => v.platform === "instagram")?.mediaIds.length === 0;

  async function submit() {
    const at = now ? null : parseLocalInput(when, tz);
    if (!now && !at) return toast.error("Pick a date and time.");
    setBusy(true);
    try {
      const res = await api<{ decision: string }>(`/api/content-posts/${post.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          ...(now ? { publishNow: true } : { scheduledFor: at!.toISOString() }),
          targets: selected.map(([platform, v]) => ({ platform, socialAccountId: v === "manual" ? null : v })),
        }),
      });
      toast.success(res.decision === "needs_approval" ? "Scheduled; waiting for approval" : now ? "Publishing now" : "Scheduled");
      onOpenChange(false);
      onScheduled();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule &quot;{post.title}&quot;</DialogTitle>
          <DialogDescription>
            Facebook, Instagram and LinkedIn publish automatically. X, TikTok and platforms without a connected account become a reminder to post by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {post.variants.map((v) => {
            const label = PLATFORM_RULES[v.platform].label;
            const broken = v.issues.some((i) => i.severity === "error");
            const accts = options[v.platform] ?? [];
            const value = choice[v.platform] ?? "";
            return (
              <div key={v.platform} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <Checkbox
                  id={`sch-${v.platform}`}
                  checked={!!value}
                  disabled={broken}
                  onCheckedChange={(c) =>
                    setChoice((m) => ({ ...m, [v.platform]: c ? (accts.find((a) => a.usable)?.id ?? "manual") : "" }))
                  }
                />
                <PlatformDot platform={v.platform} />
                <Label htmlFor={`sch-${v.platform}`} className="w-20 text-sm">
                  {label}
                </Label>
                {broken ? (
                  <span className="text-xs text-destructive">Fix this version first</span>
                ) : (
                  <Select value={value || "manual"} onValueChange={(nv) => setChoice((m) => ({ ...m, [v.platform]: nv }))} disabled={!value}>
                    <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accts.map((a) => (
                        <SelectItem key={a.id} value={a.id} disabled={!a.usable}>
                          {a.name}
                          {!a.usable ? (a.status !== "active" ? " (needs reconnecting)" : " (publishing off)") : ""}
                        </SelectItem>
                      ))}
                      <SelectItem value="manual">Remind me to post by hand</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
          {igNoMedia && <p className="text-xs text-destructive">Instagram needs an image or video. Attach one or post it by hand.</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox id="sch-now" checked={now} onCheckedChange={(c) => setNow(!!c)} />
            <Label htmlFor="sch-now" className="text-sm">
              Publish now
            </Label>
          </div>
          {!now && (
            <div className="flex items-center gap-2">
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-9 w-auto" />
              <span className="text-xs text-muted-foreground">{tz}</span>
            </div>
          )}
        </div>

        {policyNote && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> {policyNote}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || selected.length === 0 || !!igNoMedia}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />} {now ? "Publish now" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Publishing settings ───────────────────────────────────────────────

function SettingsDialog({ open, onOpenChange, settings, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; settings: PublishSettings; onSaved: (s: PublishSettings) => void }) {
  const [tz, setTz] = useState(settings.timezone);
  const [policy, setPolicy] = useState<ApprovalPolicy>(settings.contentApproval);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => [...new Set([settings.timezone, ...COMMON_TIMEZONES])], [settings.timezone]);

  async function save() {
    setBusy(true);
    try {
      onSaved(await api<PublishSettings>("/api/scheduled-posts/settings", { method: "PUT", body: JSON.stringify({ timezone: tz, contentApproval: policy }) }));
      toast.success("Publishing settings saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publishing settings</DialogTitle>
          <DialogDescription>The calendar and scheduled times use this time zone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Time zone</Label>
            <Select value={tz} onValueChange={setTz}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Approval</Label>
            <Select value={policy} onValueChange={(v) => setPolicy(v as ApprovalPolicy)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_POLICIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {APPROVAL_POLICY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {settings.teamSize === 1 ? "You're the only person in this workspace." : `${settings.teamSize} people in this workspace.`}{" "}
              Posts that need approval wait on the calendar until an admin approves them.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Calendar ──────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar-date arithmetic on "YYYY-MM-DD" keys (no time zone involved). */
function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function mondayOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((wd + 6) % 7));
}
function keyToUtc(key: string, tz: string) {
  const [y, m, d] = key.split("-").map(Number);
  return zonedToUtc(y, m, d, 0, 0, tz);
}

function Chip({ s, tz, draggable, onOpen }: { s: Schedule; tz: string; draggable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: s.id, disabled: !draggable });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const st = SCHEDULE_STATUS[s.status];
  const Icon = st.icon;
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      title={`${s.postTitle} · ${PLATFORM_RULES[s.platform]?.label ?? s.platform} · ${st.label}`}
      className={cn(
        "flex w-full items-center gap-1 rounded border bg-background px-1 py-0.5 text-left text-[11px] shadow-xs",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && "z-50 opacity-80 shadow-md",
        s.status === "failed" && "border-destructive/50",
        s.status === "published" && "opacity-70"
      )}
    >
      <PlatformDot platform={s.platform} className="size-3.5 text-[7px]" />
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(new Date(s.scheduledFor), tz)}</span>
      <span className="min-w-0 flex-1 truncate">{s.postTitle}</span>
      <Icon className={cn("size-3 shrink-0", st.className, s.status === "publishing" && "animate-spin")} />
    </button>
  );
}

function DayCell({ dayKey, muted, today, children, tall }: { dayKey: string; muted: boolean; today: boolean; children: React.ReactNode; tall?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-0 border-b border-r p-1",
        tall ? "min-h-64" : "min-h-24",
        muted && "bg-muted/30",
        isOver && "bg-primary/10"
      )}
    >
      <div className={cn("mb-1 text-[11px] font-medium", muted ? "text-muted-foreground" : "", today && "inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground")}>
        {Number(dayKey.slice(8))}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function ContentCalendar({ viewer, onOpenPost }: { viewer: Viewer; onOpenPost: (postId: string) => void }) {
  const { settings, setSettings } = usePublishSettings();
  const tz = settings?.timezone ?? "UTC";
  const todayKey = zonedDateKey(new Date(), tz);
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState<string | null>(null); // a day key inside the shown period
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const anchor = cursor ?? todayKey;
  const { days, monthKey } = useMemo(() => {
    if (mode === "week") {
      const start = mondayOf(anchor);
      return { days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), monthKey: anchor.slice(0, 7) };
    }
    const first = `${anchor.slice(0, 7)}-01`;
    const start = mondayOf(first);
    const month = first.slice(0, 7);
    const out: string[] = [];
    // Whole weeks: the one holding the 1st, then every week that starts inside the month.
    for (let week = start; week === start || week.slice(0, 7) === month; week = addDays(week, 7)) {
      for (let i = 0; i < 7; i++) out.push(addDays(week, i));
    }
    return { days: out, monthKey: month };
  }, [anchor, mode]);

  const range = useMemo(() => ({ from: keyToUtc(days[0], tz), to: keyToUtc(addDays(days[days.length - 1], 1), tz) }), [days, tz]);

  const load = useCallback(async () => {
    if (!settings) return;
    try {
      const data = await api<{ schedules: Schedule[] }>(`/api/scheduled-posts?from=${range.from.toISOString()}&to=${range.to.toISOString()}`);
      setSchedules(data.schedules);
      setSelected((sel) => (sel ? (data.schedules.find((s) => s.id === sel.id) ?? null) : null));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [range, settings]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    // Keep publishing states fresh while the calendar is open.
    const i = setInterval(load, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Schedule[]>();
    for (const s of schedules ?? []) {
      const k = zonedDateKey(new Date(s.scheduledFor), tz);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [schedules, tz]);

  const canMove = (s: Schedule) => MOVABLE.includes(s.status) && (viewer.role === "admin" || s.createdById === viewer.userId);

  async function onDragEnd(e: DragEndEvent) {
    const s = schedules?.find((x) => x.id === e.active.id);
    const day = e.over?.id as string | undefined;
    if (!s || !day || day === zonedDateKey(new Date(s.scheduledFor), tz)) return;
    const next = moveToDay(new Date(s.scheduledFor), day, tz);
    const before = schedules;
    setSchedules((list) => list?.map((x) => (x.id === s.id ? { ...x, scheduledFor: next.toISOString() } : x)) ?? null);
    try {
      await api(`/api/scheduled-posts/${s.id}`, { method: "PATCH", body: JSON.stringify({ scheduledFor: next.toISOString() }) });
      toast.success(`Moved to ${formatDateTime(next, tz)}`);
      load();
    } catch (err) {
      setSchedules(before);
      toast.error(errMsg(err));
    }
  }

  function shift(dir: 1 | -1) {
    if (mode === "week") return setCursor(addDays(anchor, 7 * dir));
    const [y, m] = monthKey.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + dir, 1));
    setCursor(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`);
  }

  const title = (() => {
    const [y, m] = monthKey.split("-").map(Number);
    const month = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
    if (mode === "month") return month;
    const fmt = (k: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(keyToUtc(k, "UTC"));
    return `${fmt(days[0])} – ${fmt(days[6])}`;
  })();

  const agenda = (schedules ?? []).filter((s) => s.status !== "cancelled");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <Button size="icon" variant="ghost" className="size-8" onClick={() => shift(-1)} aria-label="Previous">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => shift(1)} aria-label="Next">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <h2 className="font-semibold">{title}</h2>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setCursor(null)}>
          Today
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">{tz.replace(/_/g, " ")}</span>
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "month" | "week")} className="hidden sm:flex">
            <ToggleGroupItem value="month" className="px-3 text-xs">
              Month
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className="px-3 text-xs">
              Week
            </ToggleGroupItem>
          </ToggleGroup>
          {settings?.canManage && (
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" /> Settings
            </Button>
          )}
        </div>
      </div>

      {!settings || !schedules ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Grid (tablet and up) */}
          <Card className="hidden overflow-hidden p-0 sm:block">
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div className="grid grid-cols-7 border-l border-t">
                {WEEKDAY_LABELS.map((d) => (
                  <div key={d} className="border-b border-r bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
                {days.map((k) => (
                  <DayCell key={k} dayKey={k} muted={mode === "month" && k.slice(0, 7) !== monthKey} today={k === todayKey} tall={mode === "week"}>
                    {(byDay.get(k) ?? [])
                      .filter((s) => s.status !== "cancelled")
                      .map((s) => (
                        <Chip key={s.id} s={s} tz={tz} draggable={canMove(s)} onOpen={() => setSelected(s)} />
                      ))}
                  </DayCell>
                ))}
              </div>
            </DndContext>
          </Card>

          {/* Agenda (phones) */}
          <div className="space-y-2 sm:hidden">
            {agenda.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing scheduled this month.</p>
            ) : (
              agenda.map((s) => <ScheduleRow key={s.id} s={s} tz={tz} viewer={viewer} onChanged={load} onOpenPost={onOpenPost} />)
            )}
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">Drag a post to another day to move it; the time of day stays the same.</p>
        </>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <PlatformDot platform={selected.platform} /> {selected.postTitle}
                </DialogTitle>
                <DialogDescription>
                  {selected.account ? selected.account.name : `${PLATFORM_RULES[selected.platform]?.label ?? selected.platform}, posted by hand`} ·{" "}
                  {formatDateTime(new Date(selected.scheduledFor), tz)}
                </DialogDescription>
              </DialogHeader>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm">{selected.text}</pre>
              <ScheduleRow s={selected} tz={tz} viewer={viewer} onChanged={load} />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenPost(selected.postId);
                    setSelected(null);
                  }}
                >
                  Open post
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {settings && settingsOpen && (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSaved={(s) => setSettings(s)} />
      )}
    </div>
  );
}
