"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Zap,
  Plus,
  ArrowRight,
  Bell,
  FileText,
  UserPlus,
  LifeBuoy,
  CheckCircle2,
  RefreshCw,
  FileUp,
  CalendarClock,
  CalendarCheck,
  CalendarX,
  ListTodo,
  Sparkles,
  StickyNote,
  Tag,
  Pencil,
  Trash2,
  Info,
  Loader2,
  Workflow as WorkflowIcon,
  ShieldCheck,
  Clock,
  History,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface UserProp {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type TriggerType =
  | "new_lead"
  | "new_ticket"
  | "proposal_generated"
  | "proposal_accepted"
  | "lead_status_changed"
  | "document_uploaded"
  | "no_response_days"
  | "booking_created"
  | "booking_cancelled";

type ActionType =
  | "create_task"
  | "send_notification"
  | "generate_ai_followup"
  | "add_lead_note"
  | "change_lead_status"
  | "create_ticket"
  | "create_proposal_reminder";

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown> | null;
  actionType: ActionType;
  actionConfig: Record<string, unknown> | null;
  isActive: boolean;
  runCount: number;
  lastRunAt: string | null;
  totalRuns: number;
  createdAt: string;
}

interface WorkflowsResponse {
  workflows: Workflow[];
}

interface AutomationRun {
  id: string;
  workflowId: string;
  workflowName: string;
  triggerType: string;
  actionType: string;
  status: string;
  error: string | null;
  createdAt: string;
}

// ─── Static configuration ───────────────────────────────────────────
// Trigger types + friendly labels + icons + accent classes.
interface NodeConfig {
  icon: LucideIcon;
  label: string;
  iconBg: string;
  iconText: string;
}

const TRIGGER_CONFIG: Record<TriggerType, NodeConfig> = {
  new_lead: {
    icon: UserPlus,
    label: "New Lead Captured",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
  },
  new_ticket: {
    icon: LifeBuoy,
    label: "New Support Ticket",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-600 dark:text-rose-400",
  },
  proposal_generated: {
    icon: FileText,
    label: "Proposal Generated",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  proposal_accepted: {
    icon: CheckCircle2,
    label: "Proposal Accepted",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-600 dark:text-emerald-400",
  },
  lead_status_changed: {
    icon: RefreshCw,
    label: "Lead Status Changed",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  document_uploaded: {
    icon: FileUp,
    label: "Document Uploaded",
    iconBg: "bg-teal-500/10",
    iconText: "text-teal-600 dark:text-teal-400",
  },
  no_response_days: {
    icon: CalendarClock,
    label: "No Response After X Days",
    iconBg: "bg-orange-500/10",
    iconText: "text-orange-600 dark:text-orange-400",
  },
  booking_created: {
    icon: CalendarCheck,
    label: "Booking Made",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-600 dark:text-emerald-400",
  },
  booking_cancelled: {
    icon: CalendarX,
    label: "Booking Cancelled",
    iconBg: "bg-orange-500/10",
    iconText: "text-orange-600 dark:text-orange-400",
  },
};

const ACTION_CONFIG: Record<ActionType, NodeConfig> = {
  create_task: {
    icon: ListTodo,
    label: "Create Task",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
  },
  send_notification: {
    icon: Bell,
    label: "Send Notification",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  generate_ai_followup: {
    icon: Sparkles,
    label: "Generate AI Follow-up Draft",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  add_lead_note: {
    icon: StickyNote,
    label: "Add Lead Note",
    iconBg: "bg-cyan-500/10",
    iconText: "text-cyan-600 dark:text-cyan-400",
  },
  change_lead_status: {
    icon: Tag,
    label: "Change Lead Status",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-600 dark:text-emerald-400",
  },
  create_ticket: {
    icon: LifeBuoy,
    label: "Create Support Ticket",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-600 dark:text-rose-400",
  },
  create_proposal_reminder: {
    icon: CalendarClock,
    label: "Create Proposal Reminder",
    iconBg: "bg-orange-500/10",
    iconText: "text-orange-600 dark:text-orange-400",
  },
};

const TRIGGER_OPTIONS = Object.keys(TRIGGER_CONFIG) as TriggerType[];
const ACTION_OPTIONS = Object.keys(ACTION_CONFIG) as ActionType[];

const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
] as const;

// ─── Helpers ────────────────────────────────────────────────────────
function parseConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTitleCase(s: string): string {
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function triggerConfigSummary(t: TriggerType, cfg: Record<string, unknown> | null): string {
  if (t === "no_response_days") {
    const days = cfg?.days;
    return typeof days === "number" ? `${days} day${days === 1 ? "" : "s"}` : "";
  }
  if (t === "lead_status_changed") {
    const s = cfg?.leadStatus;
    return typeof s === "string" ? formatTitleCase(s) : "";
  }
  return "";
}

function actionConfigSummary(a: ActionType, cfg: Record<string, unknown> | null): string {
  if (a === "create_task") {
    const t = cfg?.taskTitle;
    return typeof t === "string" && t.trim() ? `"${t.trim()}"` : "";
  }
  if (a === "add_lead_note") {
    const t = cfg?.noteContent;
    return typeof t === "string" && t.trim()
      ? `"${t.trim().slice(0, 40)}${t.trim().length > 40 ? "…" : ""}"`
      : "";
  }
  if (a === "change_lead_status") {
    const s = cfg?.leadStatus;
    return typeof s === "string" ? formatTitleCase(s) : "";
  }
  if (a === "send_notification") {
    const s = cfg?.notificationType;
    return typeof s === "string" && s.trim() ? formatTitleCase(s) : "";
  }
  return "";
}

// ─── Visual flow node (trigger / action chip) ───────────────────────
function FlowNode({
  cfg,
  summary,
  side,
}: {
  cfg: NodeConfig;
  summary?: string;
  side: "trigger" | "action";
}) {
  const Icon = cfg.icon;
  return (
    <div
      className={cn(
        "flex-1 min-w-0 rounded-lg border bg-card px-3 py-2.5 flex items-center gap-2.5",
        side === "trigger" ? "border-border" : "border-primary/20 bg-primary/[0.03]"
      )}
    >
      <div
        className={cn(
          "size-8 rounded-md flex items-center justify-center shrink-0",
          cfg.iconBg
        )}
      >
        <Icon size={16} className={cfg.iconText} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {side === "trigger" ? "When" : "Then"}
        </div>
        <div className="text-sm font-medium text-foreground truncate">
          {cfg.label}
        </div>
        {summary ? (
          <div className="text-xs text-muted-foreground truncate">{summary}</div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Workflow card ──────────────────────────────────────────────────
function WorkflowCard({
  workflow,
  onToggle,
  onEdit,
  onDelete,
  savingId,
}: {
  workflow: Workflow;
  onToggle: (w: Workflow) => void;
  onEdit: (w: Workflow) => void;
  onDelete: (w: Workflow) => void;
  savingId: string | null;
}) {
  const triggerCfg = parseConfig(workflow.triggerConfig);
  const actionCfg = parseConfig(workflow.actionConfig);
  const triggerInfo = TRIGGER_CONFIG[workflow.triggerType] ?? TRIGGER_CONFIG.new_lead;
  const actionInfo = ACTION_CONFIG[workflow.actionType] ?? ACTION_CONFIG.create_task;
  const tSummary = triggerConfigSummary(workflow.triggerType, triggerCfg);
  const aSummary = actionConfigSummary(workflow.actionType, actionCfg);
  const isSaving = savingId === workflow.id;

  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md",
        !workflow.isActive && "opacity-75"
      )}
    >
      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground truncate">
                {workflow.name}
              </h3>
              {workflow.isActive ? (
                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground gap-1">
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  Inactive
                </Badge>
              )}
            </div>
            {workflow.description ? (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {workflow.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={workflow.isActive}
              onCheckedChange={() => onToggle(workflow)}
              disabled={isSaving}
              aria-label={`Toggle ${workflow.name}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onEdit(workflow)}
              aria-label="Edit workflow"
              title="Edit"
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(workflow)}
              aria-label="Delete workflow"
              title="Delete"
            >
              <Trash2 size={15} />
            </Button>
          </div>
        </div>

        {/* Flow visualization */}
        <div className="flex items-center gap-2 sm:gap-3">
          <FlowNode cfg={triggerInfo} summary={tSummary} side="trigger" />
          <div className="shrink-0 size-7 rounded-full bg-primary/10 flex items-center justify-center">
            <ArrowRight size={14} className="text-primary" />
          </div>
          <FlowNode cfg={actionInfo} summary={aSummary} side="action" />
        </div>

        <Separator />

        {/* Footer meta */}
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <History size={12} className="text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {workflow.runCount}
              </span>
              {workflow.runCount === 1 ? "run" : "runs"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={12} className="text-muted-foreground" />
              Last run: {relativeTime(workflow.lastRunAt)}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5">
            <WorkflowIcon size={12} />
            Created {relativeTime(workflow.createdAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton card ──────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 flex-1" />
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-16 flex-1" />
        </div>
        <Skeleton className="h-3 w-full" />
      </CardContent>
    </Card>
  );
}

// ─── Empty state ────────────────────────────────────────────────────
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed py-16 px-6 text-center">
      <div className="mx-auto size-16 rounded-2xl brand-gradient flex items-center justify-center shadow-sm">
        <Zap className="text-white" size={28} />
      </div>
      <h3 className="mt-5 text-lg font-semibold">No automation workflows yet</h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-md mx-auto">
        Create your first &ldquo;when this happens, do this&rdquo; rule to
        automate repetitive tasks like follow-ups, task creation, and
        notifications.
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus size={16} /> New Workflow
      </Button>
    </div>
  );
}

// ─── New / Edit workflow dialog ─────────────────────────────────────
interface FormState {
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerDays: string;
  triggerLeadStatus: string;
  actionType: ActionType;
  actionTaskTitle: string;
  actionNoteContent: string;
  actionLeadStatus: string;
  actionNotificationType: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  triggerType: "new_lead",
  triggerDays: "3",
  triggerLeadStatus: "contacted",
  actionType: "create_task",
  actionTaskTitle: "",
  actionNoteContent: "",
  actionLeadStatus: "contacted",
  actionNotificationType: "",
  isActive: true,
};

function WorkflowDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Workflow | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);

  // Sync form when dialog opens (new vs edit).
  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      const tc = parseConfig(editing.triggerConfig);
      const ac = parseConfig(editing.actionConfig);
      setForm({
        name: editing.name,
        description: editing.description ?? "",
        triggerType: editing.triggerType,
        triggerDays:
          typeof tc?.days === "number" ? String(tc.days) : "3",
        triggerLeadStatus:
          typeof tc?.leadStatus === "string" ? tc.leadStatus : "contacted",
        actionType: editing.actionType,
        actionTaskTitle:
          typeof ac?.taskTitle === "string" ? ac.taskTitle : "",
        actionNoteContent:
          typeof ac?.noteContent === "string" ? ac.noteContent : "",
        actionLeadStatus:
          typeof ac?.leadStatus === "string" ? ac.leadStatus : "contacted",
        actionNotificationType:
          typeof ac?.notificationType === "string" ? ac.notificationType : "",
        isActive: editing.isActive,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editing]);

  const triggerCfg = TRIGGER_CONFIG[form.triggerType];
  const actionCfg = ACTION_CONFIG[form.actionType];

  function buildTriggerConfig(): Record<string, unknown> | undefined {
    if (form.triggerType === "no_response_days") {
      const days = parseInt(form.triggerDays, 10);
      return Number.isFinite(days) && days > 0 ? { days } : { days: 3 };
    }
    if (form.triggerType === "lead_status_changed") {
      return { leadStatus: form.triggerLeadStatus };
    }
    return undefined;
  }

  function buildActionConfig(): Record<string, unknown> | undefined {
    switch (form.actionType) {
      case "create_task":
        return form.actionTaskTitle.trim()
          ? { taskTitle: form.actionTaskTitle.trim() }
          : undefined;
      case "add_lead_note":
        return form.actionNoteContent.trim()
          ? { noteContent: form.actionNoteContent.trim() }
          : undefined;
      case "change_lead_status":
        return { leadStatus: form.actionLeadStatus };
      case "send_notification":
        return form.actionNotificationType.trim()
          ? { notificationType: form.actionNotificationType.trim() }
          : undefined;
      default:
        return undefined;
    }
  }

  function validate(): string | null {
    if (form.name.trim().length < 2)
      return "Name must be at least 2 characters.";
    if (form.triggerType === "no_response_days") {
      const days = parseInt(form.triggerDays, 10);
      if (!Number.isFinite(days) || days < 1)
        return "Days must be a positive whole number.";
    }
    if (
      form.actionType === "create_task" &&
      form.actionTaskTitle.trim().length < 2
    )
      return "Task title must be at least 2 characters.";
    if (
      form.actionType === "add_lead_note" &&
      form.actionNoteContent.trim().length < 2
    )
      return "Note content must be at least 2 characters.";
    if (
      form.actionType === "send_notification" &&
      form.actionNotificationType.trim().length < 2
    )
      return "Notification type must be at least 2 characters.";
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        triggerType: form.triggerType,
        triggerConfig: buildTriggerConfig(),
        actionType: form.actionType,
        actionConfig: buildActionConfig(),
        isActive: form.isActive,
      };

      const url = editing
        ? `/api/automations/${editing.id}`
        : "/api/automations";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      toast.success(
        editing ? "Workflow updated" : "Workflow created",
        { description: form.name.trim() }
      );
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save workflow");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="text-primary" size={18} />
            {editing ? "Edit Workflow" : "New Automation Workflow"}
          </DialogTitle>
          <DialogDescription>
            Define a trigger and an action. Automations run automatically when
            conditions are met.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Name + description */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="wf-name"
                placeholder="e.g. Auto-followup for new leads"
                value={form.name}
                maxLength={100}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-desc">Description</Label>
              <Textarea
                id="wf-desc"
                placeholder="Optional — what does this workflow do?"
                value={form.description}
                rows={2}
                maxLength={500}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
          </div>

          <Separator />

          {/* Trigger section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "size-7 rounded-md flex items-center justify-center",
                  triggerCfg.iconBg
                )}
              >
                <triggerCfg.icon size={14} className={triggerCfg.iconText} />
              </div>
              <div>
                <div className="text-sm font-semibold">Trigger</div>
                <div className="text-xs text-muted-foreground">
                  When this happens…
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-trigger">Trigger type</Label>
              <Select
                value={form.triggerType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, triggerType: v as TriggerType }))
                }
              >
                <SelectTrigger id="wf-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((t) => {
                    const cfg = TRIGGER_CONFIG[t];
                    const Icon = cfg.icon;
                    return (
                      <SelectItem key={t} value={t}>
                        <span className="flex items-center gap-2">
                          <Icon
                            size={14}
                            className={cfg.iconText}
                          />
                          {cfg.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Conditional trigger config */}
            {form.triggerType === "no_response_days" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-days">
                  Days without response{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wf-days"
                  type="number"
                  min={1}
                  max={365}
                  value={form.triggerDays}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, triggerDays: e.target.value }))
                  }
                  className="max-w-[180px]"
                />
                <p className="text-xs text-muted-foreground">
                  Fires when a lead has no response for this many days.
                </p>
              </div>
            )}
            {form.triggerType === "lead_status_changed" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-trigger-status">Target lead status</Label>
                <Select
                  value={form.triggerLeadStatus}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, triggerLeadStatus: v }))
                  }
                >
                  <SelectTrigger id="wf-trigger-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {formatTitleCase(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Fires when a lead is moved to this status.
                </p>
              </div>
            )}
          </div>

          {/* Flow preview row */}
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <FlowNode cfg={triggerCfg} side="trigger" />
            </div>
            <ArrowRight size={16} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <FlowNode cfg={actionCfg} side="action" />
            </div>
          </div>

          {/* Action section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "size-7 rounded-md flex items-center justify-center",
                  actionCfg.iconBg
                )}
              >
                <actionCfg.icon size={14} className={actionCfg.iconText} />
              </div>
              <div>
                <div className="text-sm font-semibold">Action</div>
                <div className="text-xs text-muted-foreground">
                  …do this.
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-action">Action type</Label>
              <Select
                value={form.actionType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, actionType: v as ActionType }))
                }
              >
                <SelectTrigger id="wf-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((a) => {
                    const cfg = ACTION_CONFIG[a];
                    const Icon = cfg.icon;
                    return (
                      <SelectItem key={a} value={a}>
                        <span className="flex items-center gap-2">
                          <Icon size={14} className={cfg.iconText} />
                          {cfg.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Conditional action config */}
            {form.actionType === "create_task" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-task-title">
                  Task title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wf-task-title"
                  placeholder="e.g. Follow up with new lead"
                  value={form.actionTaskTitle}
                  maxLength={200}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      actionTaskTitle: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            {form.actionType === "add_lead_note" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-note">
                  Note content <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="wf-note"
                  placeholder="e.g. Auto-flagged: lead has not responded."
                  rows={3}
                  maxLength={1000}
                  value={form.actionNoteContent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      actionNoteContent: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            {form.actionType === "change_lead_status" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-action-status">New lead status</Label>
                <Select
                  value={form.actionLeadStatus}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, actionLeadStatus: v }))
                  }
                >
                  <SelectTrigger id="wf-action-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {formatTitleCase(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.actionType === "send_notification" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-notif">
                  Notification type{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wf-notif"
                  placeholder="e.g. New lead, Proposal accepted"
                  value={form.actionNotificationType}
                  maxLength={100}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      actionNotificationType: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Internal in-app notification label (no external message is
                  sent).
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">
                Inactive workflows are saved but never fire.
              </div>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) =>
                setForm((f) => ({ ...f, isActive: v }))
              }
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Zap size={14} /> {editing ? "Save Changes" : "Create Workflow"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirmation ────────────────────────────────────────────
function DeleteDialog({
  workflow,
  open,
  onOpenChange,
  onConfirm,
  deleting,
}: {
  workflow: Workflow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this workflow?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete{" "}
            <span className="font-medium text-foreground">
              {workflow?.name}
            </span>
            . Its run history will also be removed. This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 size={14} /> Delete
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Run history panel ──────────────────────────────────────────────
function RunHistoryPanel() {
  const [runs, setRuns] = React.useState<AutomationRun[]>([]);
  const [loading, setLoading] = React.useState(true);

  const fetchRuns = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automations/runs?limit=30", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      toast.error("Failed to load run history");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <History className="text-primary" size={18} />
          <div>
            <h2 className="text-base font-semibold">Run History</h2>
            <p className="text-xs text-muted-foreground">Recent automation executions</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      <CardContent className="p-0">
        {loading && runs.length === 0 ? (
          <div className="p-6 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No runs yet. Active workflows log here when their triggers fire.
          </p>
        ) : (
          <div className="divide-y max-h-80 overflow-y-auto scroll-thin">
            {runs.map((run) => (
              <div key={run.id} className="px-6 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{run.workflowName}</p>
                  <p className="text-xs text-muted-foreground">
                    {run.triggerType.replace(/_/g, " ")} → {run.actionType.replace(/_/g, " ")}
                  </p>
                  {run.error && (
                    <p className="text-xs text-destructive mt-1 truncate">{run.error}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <Badge
                    variant={run.status === "success" ? "secondary" : "outline"}
                    className={cn(
                      "text-xs",
                      run.status === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      run.status === "failed" && "text-destructive border-destructive/30"
                    )}
                  >
                    {run.status}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(run.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main view ──────────────────────────────────────────────────────
export function AutomationsView({ user }: { user: UserProp }) {
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Workflow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Workflow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const fetchWorkflows = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automations", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const data: WorkflowsResponse = await res.json();
      setWorkflows(data.workflows ?? []);
    } catch {
      toast.error("Failed to load automations");
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(w: Workflow) {
    setEditing(w);
    setDialogOpen(true);
  }

  async function handleToggle(w: Workflow) {
    setSavingId(w.id);
    const next = !w.isActive;
    // Optimistic update.
    setWorkflows((list) =>
      list.map((x) => (x.id === w.id ? { ...x, isActive: next } : x))
    );
    try {
      const res = await fetch(`/api/automations/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(
        next ? "Workflow activated" : "Workflow paused",
        { description: w.name }
      );
    } catch {
      // Revert on failure.
      setWorkflows((list) =>
        list.map((x) => (x.id === w.id ? { ...x, isActive: !next } : x))
      );
      toast.error("Failed to update workflow");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/automations/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Workflow deleted", { description: deleteTarget.name });
      setDeleteTarget(null);
      fetchWorkflows();
    } catch {
      toast.error("Failed to delete workflow");
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = workflows.filter((w) => w.isActive).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="text-primary" size={22} />
            Automation Workflows
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automate repetitive tasks with when→then rules.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="bg-card gap-1.5 py-1 px-2.5 text-xs"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="font-semibold text-foreground">{activeCount}</span>{" "}
            active
          </Badge>
          <Badge
            variant="outline"
            className="bg-card gap-1.5 py-1 px-2.5 text-xs"
          >
            <WorkflowIcon size={12} className="text-primary" />
            <span className="font-semibold text-foreground">
              {workflows.length}
            </span>{" "}
            {workflows.length === 1 ? "workflow" : "workflows"}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchWorkflows()}
            disabled={loading}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw
              size={15}
              className={loading ? "animate-spin" : ""}
            />
          </Button>
          <Button onClick={openNew}>
            <Plus size={16} /> New Workflow
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <Alert className="border-primary/20 bg-primary/[0.04]">
        <ShieldCheck className="text-primary" size={16} />
        <AlertDescription className="text-sm text-foreground">
          <span className="font-semibold">Safe by design.</span>{" "}
          Automations create internal tasks, notifications, and drafts only. No
          external messages (WhatsApp/Email) are sent automatically — all AI
          outputs require manual review.
        </AlertDescription>
      </Alert>

      {/* List */}
      {loading && workflows.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState onCreate={openNew} />
      ) : (
        <div className="space-y-3">
          {workflows.map((w) => (
            <WorkflowCard
              key={w.id}
              workflow={w}
              onToggle={handleToggle}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              savingId={savingId}
            />
          ))}
        </div>
      )}

      <RunHistoryPanel />

      {/* Footer hint */}
      {workflows.length > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-1">
          Automations are scoped to{" "}
          <span className="font-medium text-foreground">
            {user.businessName}
          </span>{" "}
          and run server-side when their trigger fires.
        </p>
      )}

      {/* Dialogs */}
      <WorkflowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={fetchWorkflows}
      />
      <DeleteDialog
        workflow={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />
    </div>
  );
}
