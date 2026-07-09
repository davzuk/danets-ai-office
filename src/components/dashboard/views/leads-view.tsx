"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  Users,
  Flame,
  TrendingUp,
  Sparkles,
  MoreHorizontal,
  Trash2,
  Phone,
  Mail,
  MessageCircle,
  MessageSquare,
  Inbox,
  Filter,
  X,
  RefreshCw,
  Download,
  CheckCircle2,
  CircleDot,
  Target,
  CalendarClock,
  ArrowUpRight,
  Tag,
  ExternalLink,
  UserCircle2,
  StickyNote,
  CheckSquare,
  Activity as ActivityIcon,
  DollarSign,
  Building2,
  CalendarDays,
  Plus,
  Clock,
  Check,
  History,
  ListChecks,
  PenSquare,
  ArrowRight,
  RotateCcw,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PipelineBoard } from "@/components/dashboard/views/lead-pipeline-board";
import { LayoutGrid, List } from "lucide-react";

interface UserProp {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "negotiation"
  | "won"
  | "lost";
type LeadQuality = "low" | "medium" | "high";

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  service: string | null;
  message: string | null;
  quality: LeadQuality;
  status: LeadStatus;
  source: string;
  sessionId: string | null;
  visitorEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LeadDetail extends Lead {
  session: {
    id: string;
    visitorEmail: string | null;
    visitorName: string | null;
    visitorPhone: string | null;
    status: string;
    summary: string | null;
    nextAction: string | null;
    leadQuality: string | null;
  } | null;
  dealValue: number;
  leadScore: number;
  company: string | null;
  expectedCloseDate: string | null;
  notes: LeadNote[];
  tasks: LeadTask[];
  activities: LeadActivity[];
}

interface LeadNote {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

interface LeadTask {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

interface LeadActivity {
  id: string;
  type: string;
  description: string;
  actorName: string | null;
  createdAt: string;
}

interface LeadStats {
  total: number;
  new: number;
  high: number;
  won: number;
  conversionRate: number;
  byQuality: { quality: string; count: number }[];
  byStatus: { status: string; count: number }[];
  thisWeek: number;
}

const STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
];
const QUALITIES: LeadQuality[] = ["low", "medium", "high"];

/** Title-case a LeadStatus, e.g. "proposal_sent" → "Proposal Sent". */
function formatStatus(s: LeadStatus): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── badge styling ───────────────────────────────────────────────
function qualityBadgeClass(q: LeadQuality) {
  switch (q) {
    case "high":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "medium":
      return "bg-accent/30 text-accent-foreground border-accent/40";
    case "low":
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function statusBadgeClass(s: LeadStatus) {
  switch (s) {
    case "new":
      return "bg-primary/10 text-primary border-primary/20";
    case "contacted":
      return "bg-muted text-muted-foreground border-border";
    case "qualified":
      return "bg-accent/40 text-accent-foreground border-accent/50 font-medium";
    case "proposal_sent":
      return "bg-primary/15 text-primary border-primary/30 font-medium";
    case "negotiation":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-medium";
    case "won":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "lost":
      return "bg-destructive/10 text-destructive border-destructive/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function QualityBadge({ quality }: { quality: LeadQuality }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize gap-1", qualityBadgeClass(quality))}
    >
      {quality === "high" && <Flame size={11} />}
      {quality}
    </Badge>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1", statusBadgeClass(status))}
    >
      {status === "new" && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      )}
      {formatStatus(status)}
    </Badge>
  );
}

// ─── date helpers ────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

// ─── Quick reply helpers ─────────────────────────────────────────
// All helpers are pure (except the action wrappers that call window + toast).
// `LeadContact` is satisfied by both `Lead` (table row) and `LeadDetail` (dialog).
type LeadContact = Pick<
  Lead,
  "name" | "email" | "phone" | "service" | "message"
>;

/** Contextual WhatsApp message body (NOT URL-encoded). */
function buildWhatsAppMessage(lead: LeadContact): string {
  const name = lead.name?.trim() || "there";
  const service = lead.service?.trim();
  const msg = lead.message?.trim();

  const greeting = service
    ? `Hi ${name}, thanks for your interest in ${service}. How can we help?`
    : `Hi ${name}, thanks for reaching out. How can we help?`;

  if (!msg) return greeting;
  const snippet = msg.slice(0, 280);
  const ellipsis = msg.length > 280 ? "…" : "";
  return `${greeting}\n\nYou mentioned: "${snippet}${ellipsis}"`;
}

/** Contextual email subject line. */
function buildEmailSubject(lead: LeadContact): string {
  const service = lead.service?.trim();
  return service
    ? `Re: Your inquiry about ${service}`
    : "Re: Your inquiry";
}

/** Contextual email body (plain text, line-break separated). */
function buildEmailBody(lead: LeadContact): string {
  const name = lead.name?.trim() || "there";
  const service = lead.service?.trim();
  const msg = lead.message?.trim();

  const lines: string[] = [];
  lines.push(`Hi ${name},`);
  lines.push("");
  lines.push(
    service
      ? `Thanks for reaching out about ${service}. We'd love to help!`
      : `Thanks for reaching out. We'd love to help!`
  );
  if (msg) {
    const snippet = msg.slice(0, 400);
    const ellipsis = msg.length > 400 ? "…" : "";
    lines.push("");
    lines.push("You mentioned:");
    lines.push(`"${snippet}${ellipsis}"`);
  }
  lines.push("");
  lines.push(
    "We'll get back to you shortly. Feel free to reply with any additional details."
  );
  lines.push("");
  lines.push("Best regards,");
  lines.push("The Danets Team");
  return lines.join("\n");
}

/** Strip a phone string to digits-only for wa.me (intl format, no `+`). */
function normalizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Build a `https://wa.me/<digits>?text=<encoded>` URL, or null if no usable phone. */
function buildWhatsAppUrl(lead: LeadContact): string | null {
  if (!lead.phone) return null;
  const digits = normalizePhoneForWhatsApp(lead.phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(
    buildWhatsAppMessage(lead)
  )}`;
}

/** Build a `mailto:` URL with prefilled subject + body, or null if no email. */
function buildMailtoUrl(lead: LeadContact): string | null {
  if (!lead.email) return null;
  const subject = encodeURIComponent(buildEmailSubject(lead));
  const body = encodeURIComponent(buildEmailBody(lead));
  return `mailto:${lead.email}?subject=${subject}&body=${body}`;
}

/** Build a `tel:` URL (whitespace stripped), or null if no phone. */
function buildTelUrl(lead: LeadContact): string | null {
  if (!lead.phone) return null;
  return `tel:${lead.phone.replace(/\s+/g, "")}`;
}

/** Open WhatsApp in a new tab with a prefilled message + sonner feedback. */
function openWhatsApp(lead: LeadContact) {
  const url = buildWhatsAppUrl(lead);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
  toast.success("Opening WhatsApp…");
}

/** Trigger the OS mailto handler with prefilled subject/body + sonner feedback. */
function openEmail(lead: LeadContact) {
  const url = buildMailtoUrl(lead);
  if (!url) return;
  window.location.href = url;
  toast.success("Opening email client…");
}

/** Trigger the OS tel handler + sonner feedback. */
function openCall(lead: LeadContact) {
  const url = buildTelUrl(lead);
  if (!url) return;
  window.location.href = url;
  toast.success("Initiating call…");
}

// ─── Stat card ───────────────────────────────────────────────────
function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: "blue" | "green" | "amber" | "rose";
  loading?: boolean;
}) {
  const accentCls =
    accent === "green"
      ? "bg-accent/20 text-accent-foreground"
      : accent === "amber"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : accent === "rose"
      ? "bg-destructive/10 text-destructive"
      : "bg-primary/10 text-primary";

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-4 flex items-center gap-4">
        <div
          className={cn(
            "size-10 rounded-lg flex items-center justify-center shrink-0",
            accentCls
          )}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          {loading ? (
            <div className="h-6 w-12 mt-0.5 rounded bg-muted animate-pulse" />
          ) : (
            <div className="text-xl font-bold leading-tight truncate">
              {value}
            </div>
          )}
          {hint && (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {hint}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── CRM patch payload (shared by parent + dialog) ───────────────
type LeadPatch = {
  status?: LeadStatus;
  quality?: LeadQuality;
  dealValue?: number;
  leadScore?: number;
  company?: string | null;
  expectedCloseDate?: string | null;
  service?: string | null;
};

// ─── Detail Dialog ───────────────────────────────────────────────
function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
  onSave,
  onAddNote,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onDeleted,
  onScoreLead,
  scoring,
  saving,
}: {
  lead: LeadDetail | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (id: string, patch: LeadPatch) => Promise<boolean>;
  onAddNote: (id: string, content: string) => Promise<boolean>;
  onAddTask: (id: string, title: string, dueDate: string | null) => Promise<boolean>;
  onToggleTask: (id: string, taskId: string, completed: boolean) => Promise<boolean>;
  onDeleteTask: (id: string, taskId: string) => Promise<boolean>;
  onDeleted: (id: string) => void;
  onScoreLead: (id: string) => Promise<void>;
  scoring: boolean;
  saving: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("details");

  // Reset transient state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setActiveTab("details");
    }
  }, [open]);

  if (!lead) return null;

  const isNew = lead.status === "new";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <Avatar className="size-11 shrink-0">
              <AvatarFallback className="brand-gradient text-white font-semibold">
                {initials(lead.name) || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate flex items-center gap-2">
                <span className="truncate">{lead.name}</span>
                {lead.company && (
                  <span className="text-xs font-normal text-muted-foreground hidden sm:inline">
                    · {lead.company}
                  </span>
                )}
                {isNew && (
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="truncate">
                {lead.service || "General inquiry"} · {relativeTime(lead.createdAt)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1 gap-1.5">
              <CircleDot size={13} />
              <span className="hidden sm:inline">Details</span>
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex-1 gap-1.5">
              <StickyNote size={13} />
              <span className="hidden sm:inline">Notes</span>
              {lead.notes.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 min-w-4 justify-center">
                  {lead.notes.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex-1 gap-1.5">
              <CheckSquare size={13} />
              <span className="hidden sm:inline">Tasks</span>
              {lead.tasks.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 min-w-4 justify-center">
                  {lead.tasks.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex-1 gap-1.5">
              <ActivityIcon size={13} />
              <span className="hidden sm:inline">Activity</span>
            </TabsTrigger>
            <TabsTrigger value="conversation" className="flex-1 gap-1.5">
              <MessageCircle size={13} />
              <span className="hidden sm:inline">Chat</span>
            </TabsTrigger>
          </TabsList>

          {/* ─── Details tab ─── */}
          <TabsContent value="details" className="mt-4 space-y-4">
            {/* Contact info */}
            <div className="grid sm:grid-cols-2 gap-3">
              <InfoRow
                icon={Mail}
                label="Email"
                value={lead.email || "—"}
                href={lead.email ? `mailto:${lead.email}` : undefined}
              />
              <InfoRow
                icon={Phone}
                label="Phone"
                value={lead.phone || "—"}
                href={lead.phone ? `tel:${lead.phone}` : undefined}
              />
              <InfoRow
                icon={Tag}
                label="Service"
                value={lead.service || "—"}
              />
              <InfoRow
                icon={CircleDot}
                label="Source"
                value={<span className="capitalize">{lead.source}</span>}
              />
            </div>

            {/* Message */}
            {lead.message && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <MessageSquare size={12} /> Message
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {lead.message}
                </p>
              </div>
            )}

            {/* CRM fields (editable, PATCH on blur) */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <DollarSign size={13} className="text-primary" />
                  CRM
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Edits save automatically
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <CrmFieldEditor
                  label="Deal Value"
                  icon={DollarSign}
                  value={lead.dealValue ?? 0}
                  type="number"
                  min={0}
                  prefix="$"
                  placeholder="0"
                  onSave={(v) =>
                    onSave(lead.id, { dealValue: typeof v === "number" ? v : 0 })
                  }
                  disabled={saving}
                />
                <div className="space-y-1.5">
                  <CrmFieldEditor
                    label="Lead Score"
                    icon={Target}
                    value={lead.leadScore ?? 0}
                    type="number"
                    min={0}
                    max={100}
                    suffix="/ 100"
                    showProgress
                    onSave={(v) =>
                      onSave(lead.id, {
                        leadScore: typeof v === "number" ? v : 0,
                      })
                    }
                    disabled={saving || scoring}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 h-8 text-xs"
                    disabled={saving || scoring}
                    onClick={() => onScoreLead(lead.id)}
                  >
                    {scoring ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    AI score lead
                  </Button>
                </div>
                <CrmFieldEditor
                  label="Company"
                  icon={Building2}
                  value={lead.company ?? ""}
                  type="text"
                  placeholder="—"
                  onSave={(v) =>
                    onSave(lead.id, { company: (v as string) || null })
                  }
                  disabled={saving}
                />
                <CrmFieldEditor
                  label="Expected Close Date"
                  icon={CalendarDays}
                  value={
                    lead.expectedCloseDate
                      ? lead.expectedCloseDate.slice(0, 10)
                      : ""
                  }
                  type="date"
                  onSave={(v) =>
                    onSave(lead.id, {
                      expectedCloseDate: v
                        ? new Date(`${v}T12:00:00`).toISOString()
                        : null,
                    })
                  }
                  disabled={saving}
                />
              </div>
            </div>

            {/* Quick reply actions */}
            <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <MessageCircle size={13} className="text-primary" />
                  Quick reply
                </div>
                {!lead.phone && !lead.email && (
                  <span className="text-[11px] text-muted-foreground">
                    No contact details
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5 text-white border-transparent hover:opacity-90"
                  style={{ backgroundColor: "#25D366" }}
                  disabled={!lead.phone}
                  onClick={() => openWhatsApp(lead)}
                  title={lead.phone ? `WhatsApp ${lead.phone}` : "No phone on file"}
                >
                  <MessageCircle size={15} />
                  WhatsApp
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={!lead.email}
                  onClick={() => openEmail(lead)}
                  title={lead.email ? `Email ${lead.email}` : "No email on file"}
                >
                  <Mail size={15} />
                  Email
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!lead.phone}
                  onClick={() => openCall(lead)}
                  title={lead.phone ? `Call ${lead.phone}` : "No phone on file"}
                >
                  <Phone size={15} />
                  Call
                </Button>
              </div>
            </div>

            {/* Status & quality controls */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Status
                </Label>
                <Select
                  value={lead.status}
                  onValueChange={(v) =>
                    onSave(lead.id, { status: v as LeadStatus })
                  }
                  disabled={saving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {formatStatus(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Quality
                </Label>
                <Select
                  value={lead.quality}
                  onValueChange={(v) =>
                    onSave(lead.id, { quality: v as LeadQuality })
                  }
                  disabled={saving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALITIES.map((q) => (
                      <SelectItem key={q} value={q} className="capitalize">
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <span className="flex items-center gap-1">
                <CalendarClock size={12} />
                Created {fullDate(lead.createdAt)}
              </span>
              <span className="flex items-center gap-1">
                <RefreshCw size={12} />
                Updated {fullDate(lead.updatedAt)}
              </span>
            </div>
          </TabsContent>

          {/* ─── Notes tab ─── */}
          <TabsContent value="notes" className="mt-4">
            <NotesTab lead={lead} onAddNote={onAddNote} saving={saving} />
          </TabsContent>

          {/* ─── Tasks tab ─── */}
          <TabsContent value="tasks" className="mt-4">
            <TasksTab
              lead={lead}
              onAddTask={onAddTask}
              onToggleTask={onToggleTask}
              onDeleteTask={onDeleteTask}
              saving={saving}
            />
          </TabsContent>

          {/* ─── Activity tab ─── */}
          <TabsContent value="activity" className="mt-4">
            <ActivityTab activities={lead.activities} />
          </TabsContent>

          {/* ─── Conversation tab ─── */}
          <TabsContent value="conversation" className="mt-4">
            {lead.session ? (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <UserCircle2 size={16} className="text-primary" />
                      {lead.session.visitorName ||
                        lead.session.visitorEmail ||
                        "Anonymous visitor"}
                    </div>
                    <Badge variant="secondary" className="capitalize text-xs">
                      {lead.session.status}
                    </Badge>
                  </div>
                  {(lead.session.visitorEmail ||
                    lead.session.visitorPhone) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {lead.session.visitorEmail && (
                        <span className="flex items-center gap-1">
                          <Mail size={11} />
                          {lead.session.visitorEmail}
                        </span>
                      )}
                      {lead.session.visitorPhone && (
                        <span className="flex items-center gap-1">
                          <Phone size={11} />
                          {lead.session.visitorPhone}
                        </span>
                      )}
                    </div>
                  )}
                  {lead.session.leadQuality && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">AI quality:</span>{" "}
                      <span className="capitalize font-medium">
                        {lead.session.leadQuality}
                      </span>
                    </div>
                  )}
                  {lead.session.summary && (
                    <div className="text-sm text-foreground/80 border-t pt-2 mt-1">
                      {lead.session.summary}
                    </div>
                  )}
                  {lead.session.nextAction && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">
                        Suggested next action:
                      </span>{" "}
                      <span className="text-foreground">
                        {lead.session.nextAction}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ExternalLink size={12} />
                  Open the Conversations view for the full chat transcript.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed py-10 text-center">
                <MessageSquare className="mx-auto text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground mt-2">
                  No linked conversation
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  This lead was captured without a chat session.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={saving}
            className="mr-auto"
          >
            <Trash2 size={14} />
            Delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{lead.name}</strong> from
              your leads. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                onDeleted(lead.id);
                setConfirmDelete(false);
              }}
            >
              Delete lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ─── CRM field editor (inline editable, PATCH on blur) ───────────
function CrmFieldEditor({
  label,
  icon: Icon,
  value,
  onSave,
  type = "text",
  prefix,
  suffix,
  min,
  max,
  placeholder,
  showProgress,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: string | number | null;
  onSave: (v: string | number | null) => Promise<boolean>;
  type?: "text" | "number" | "date";
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  showProgress?: boolean;
  disabled?: boolean;
}) {
  const displayValue =
    type === "number"
      ? value !== undefined && value !== null && value !== ""
        ? String(value)
        : ""
      : (value as string) || "";

  const [localValue, setLocalValue] = React.useState<string>(displayValue);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setLocalValue(displayValue);
  }, [displayValue]);

  React.useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function commit() {
    if (localValue === displayValue) return;
    let v: string | number | null = localValue;
    if (type === "number") {
      const n = Number(localValue);
      v = isNaN(n) ? 0 : n;
      if (min !== undefined) v = Math.max(min, v as number);
      if (max !== undefined) v = Math.min(max, v as number);
    } else if (type === "date") {
      v = localValue || null;
    } else {
      v = localValue || null;
    }
    setStatus("saving");
    const ok = await onSave(v);
    if (ok) {
      setStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus("idle"), 1500);
    } else {
      setLocalValue(displayValue); // revert on failure
      setStatus("idle");
    }
  }

  const progressValue =
    type === "number" && showProgress
      ? Math.max(0, Math.min(100, Number(localValue) || 0))
      : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground gap-1.5 font-medium">
          <Icon size={12} />
          {label}
        </Label>
        {status === "saving" && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" />
            Saving…
          </span>
        )}
        {status === "saved" && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check size={10} />
            Saved
          </span>
        )}
      </div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        <Input
          type={type}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("h-9", prefix && "pl-7", suffix && "pr-14")}
        />
        {suffix && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {showProgress && type === "number" && (
        <Progress value={progressValue} className="h-1.5" />
      )}
    </div>
  );
}

// ─── Notes tab ───────────────────────────────────────────────────
function NotesTab({
  lead,
  onAddNote,
  saving,
}: {
  lead: LeadDetail;
  onAddNote: (id: string, content: string) => Promise<boolean>;
  saving: boolean;
}) {
  const [content, setContent] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const ok = await onAddNote(lead.id, trimmed);
    setSubmitting(false);
    if (ok) setContent("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
        <Label className="text-xs gap-1.5 text-foreground font-medium">
          <PenSquare size={12} className="text-primary" />
          Add a note
        </Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type an internal note about this lead…"
          rows={3}
          maxLength={5000}
          disabled={submitting || saving}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {content.length}/5000 · ⌘/Ctrl+Enter to save
          </span>
          <Button
            size="sm"
            onClick={submit}
            disabled={!content.trim() || submitting || saving}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Add note
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        {lead.notes.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <StickyNote className="mx-auto text-muted-foreground/60" size={20} />
            <p className="text-sm text-muted-foreground mt-2">No notes yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Add internal context, history, or strategy notes for this lead.
            </p>
          </div>
        ) : (
          lead.notes.map((note) => (
            <div key={note.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start gap-2.5">
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="text-[10px] font-semibold bg-accent/40 text-accent-foreground">
                    {initials(note.authorName) || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">
                      {note.authorName}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {relativeTime(note.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words mt-1 text-foreground/90">
                    {note.content}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Tasks tab ───────────────────────────────────────────────────
function TasksTab({
  lead,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  saving,
}: {
  lead: LeadDetail;
  onAddTask: (id: string, title: string, dueDate: string | null) => Promise<boolean>;
  onToggleTask: (id: string, taskId: string, completed: boolean) => Promise<boolean>;
  onDeleteTask: (id: string, taskId: string) => Promise<boolean>;
  saving: boolean;
}) {
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const ok = await onAddTask(lead.id, trimmed, dueDate || null);
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setDueDate("");
    }
  }

  const completedCount = lead.tasks.filter((t) => t.completed).length;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
        <Label className="text-xs gap-1.5 text-foreground font-medium">
          <Plus size={12} className="text-primary" />
          Create a task
        </Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Send proposal, follow-up call…"
            disabled={submitting || saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="flex-1 h-9"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={submitting || saving}
            className="sm:w-[160px] h-9"
            aria-label="Due date"
          />
          <Button
            size="sm"
            onClick={submit}
            disabled={!title.trim() || submitting || saving}
            className="gap-1.5 sm:h-9"
          >
            {submitting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Add
          </Button>
        </div>
      </div>

      <Separator />

      {lead.tasks.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ListChecks size={12} />
            {lead.tasks.length} {lead.tasks.length === 1 ? "task" : "tasks"}
          </span>
          <span>
            {completedCount} / {lead.tasks.length} completed
          </span>
        </div>
      )}

      <div className="space-y-2">
        {lead.tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <CheckSquare className="mx-auto text-muted-foreground/60" size={20} />
            <p className="text-sm text-muted-foreground mt-2">No tasks yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Create follow-up tasks, reminders, or action items for this lead.
            </p>
          </div>
        ) : (
          lead.tasks.map((task) => {
            const overdue =
              !task.completed &&
              !!task.dueDate &&
              new Date(task.dueDate).getTime() < Date.now();
            return (
              <div
                key={task.id}
                className={cn(
                  "rounded-lg border bg-card p-3 flex items-start gap-2.5",
                  overdue && "border-destructive/40 bg-destructive/[0.03]"
                )}
              >
                <Checkbox
                  checked={task.completed}
                  onCheckedChange={(v) =>
                    onToggleTask(lead.id, task.id, !!v)
                  }
                  disabled={saving}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium break-words",
                        task.completed && "line-through text-muted-foreground"
                      )}
                    >
                      {task.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteTask(lead.id, task.id)}
                      disabled={saving}
                      aria-label="Delete task"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                      {task.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                    {task.dueDate && (
                      <span
                        className={cn(
                          "flex items-center gap-1",
                          overdue && "text-destructive font-medium"
                        )}
                      >
                        <CalendarClock size={11} />
                        Due {relativeTime(task.dueDate)}
                      </span>
                    )}
                    {task.completed && task.completedAt && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={11} />
                        Done {relativeTime(task.completedAt)}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      Added {relativeTime(task.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Activity tab (vertical timeline) ────────────────────────────
function activityStyle(type: string): {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
} {
  switch (type) {
    case "status_change":
      return { Icon: ArrowRight, color: "border-primary/30 bg-primary/10 text-primary" };
    case "note_added":
      return {
        Icon: StickyNote,
        color: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      };
    case "task_created":
      return {
        Icon: Plus,
        color: "border-accent/40 bg-accent/20 text-accent-foreground",
      };
    case "task_completed":
      return {
        Icon: CheckCircle2,
        color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      };
    case "task_reopened":
      return {
        Icon: RotateCcw,
        color: "border-muted-foreground/30 bg-muted text-muted-foreground",
      };
    default:
      return {
        Icon: ActivityIcon,
        color: "border-muted-foreground/30 bg-muted text-muted-foreground",
      };
  }
}

function ActivityTab({ activities }: { activities: LeadActivity[] }) {
  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-8 text-center">
        <History className="mx-auto text-muted-foreground/60" size={20} />
        <p className="text-sm text-muted-foreground mt-2">No activity yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Status changes, notes, and task updates will appear here in chronological order.
        </p>
      </div>
    );
  }

  return (
    <div className="relative pl-1">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border" aria-hidden />
      <ol className="space-y-3.5">
        {activities.map((a) => {
          const { Icon, color } = activityStyle(a.type);
          return (
            <li key={a.id} className="relative flex items-start gap-3">
              <div
                className={cn(
                  "relative z-10 size-8 rounded-full flex items-center justify-center shrink-0 border bg-card",
                  color
                )}
              >
                <Icon size={14} />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm text-foreground/90 break-words">
                  {a.description}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  {a.actorName && (
                    <span className="flex items-center gap-1">
                      <UserCircle2 size={10} />
                      {a.actorName}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {relativeTime(a.createdAt)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: React.ReactNode;
  href?: string;
}) {
  const content = (
    <div className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <Icon size={15} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block hover:opacity-80 transition-opacity">
        {content}
      </a>
    );
  }
  return content;
}

// ─── Row actions dropdown ────────────────────────────────────────
function LeadRowActions({
  lead,
  onStatusChange,
  onDelete,
}: {
  lead: Lead;
  onStatusChange: (lead: Lead, status: LeadStatus) => void;
  onDelete: (lead: Lead) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(e) => e.stopPropagation()}
          aria-label="Lead actions"
        >
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MessageCircle size={14} /> Quick reply
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              disabled={!lead.phone}
              onClick={() => openWhatsApp(lead)}
            >
              <MessageCircle size={14} className="text-[#25D366]" />
              WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!lead.email}
              onClick={() => openEmail(lead)}
            >
              <Mail size={14} className="text-primary" />
              Email
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!lead.phone}
              onClick={() => openCall(lead)}
            >
              <Phone size={14} />
              Call
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Update status</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onStatusChange(lead, "contacted")}
          disabled={lead.status === "contacted"}
        >
          <MessageSquare size={14} /> Mark contacted
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onStatusChange(lead, "qualified")}
          disabled={lead.status === "qualified"}
        >
          <Target size={14} /> Mark qualified
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onStatusChange(lead, "proposal_sent")}
          disabled={lead.status === "proposal_sent"}
        >
          <ArrowRight size={14} className="text-primary" /> Mark proposal sent
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onStatusChange(lead, "negotiation")}
          disabled={lead.status === "negotiation"}
        >
          <DollarSign size={14} className="text-amber-600 dark:text-amber-400" /> Mark negotiation
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onStatusChange(lead, "won")}
          disabled={lead.status === "won"}
        >
          <CheckCircle2 size={14} className="text-emerald-600" /> Mark won
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onStatusChange(lead, "lost")}
          disabled={lead.status === "lost"}
        >
          <X size={14} className="text-destructive" /> Mark lost
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDelete(lead)}
        >
          <Trash2 size={14} /> Delete lead
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Empty state ─────────────────────────────────────────────────
function EmptyState({
  hasFilters,
  onRefresh,
  onClearFilters,
}: {
  hasFilters: boolean;
  onRefresh: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed py-16 px-6 text-center">
      <div className="mx-auto size-14 rounded-full bg-accent/20 flex items-center justify-center">
        <Inbox className="text-accent-foreground" size={26} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">
        {hasFilters ? "No matching leads" : "No leads yet"}
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-md mx-auto">
        {hasFilters
          ? "Try adjusting or clearing your filters to see more leads."
          : "Leads captured by your AI chatbot will appear here. Embed the widget on your website to start collecting leads."}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
        {hasFilters ? (
          <Button onClick={onClearFilters} variant="outline">
            <Filter size={14} /> Clear filters
          </Button>
        ) : (
          <Button onClick={onRefresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────
export function LeadsView({ user }: { user: UserProp }) {
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState<LeadStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(true);

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [qualityFilter, setQualityFilter] = React.useState<string>("all");

  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedLead, setSelectedLead] = React.useState<LeadDetail | null>(
    null
  );
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [scoring, setScoring] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<Lead | null>(null);
  const [viewMode, setViewMode] = React.useState<"list" | "pipeline">("list");

  // ─── Debounce search input ─────────────────────────────────────
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const hasFilters = !!search || statusFilter !== "all" || qualityFilter !== "all";

  // ─── Fetch list ────────────────────────────────────────────────
  const fetchLeads = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (qualityFilter !== "all") params.set("quality", qualityFilter);
      const res = await fetch(`/api/leads?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      toast.error("Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, qualityFilter]);

  React.useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // ─── Fetch stats ───────────────────────────────────────────────
  const fetchStats = React.useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/leads/stats", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load stats");
      const data = await res.json();
      setStats(data);
    } catch {
      /* silent */
    } finally {
      setStatsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ─── Open detail dialog (fetch full lead w/ session + CRM data) ─
  async function openDetail(lead: Lead) {
    setSelectedLead({
      ...lead,
      session: null,
      dealValue: 0,
      leadScore: 0,
      company: null,
      expectedCloseDate: null,
      notes: [],
      tasks: [],
      activities: [],
    });
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load lead");
      const data = await res.json();
      setSelectedLead(data.lead);
    } catch {
      toast.error("Failed to load lead details");
    } finally {
      setDetailLoading(false);
    }
  }

  // ─── AI lead scoring ───────────────────────────────────────────
  async function scoreLeadWithAi(leadId: string) {
    setScoring(true);
    try {
      const res = await fetch("/api/ai/score-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scoring failed");
      const score = data.score ?? 0;
      toast.success(`Lead scored: ${score}/100`);
      setSelectedLead((prev) =>
        prev && prev.id === leadId ? { ...prev, leadScore: score } : prev
      );
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, leadScore: score } : l))
      );
      fetchStats();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to score lead");
    } finally {
      setScoring(false);
    }
  }

  // ─── Save (PATCH) — supports status, quality, and CRM fields ────
  async function updateLead(id: string, patch: LeadPatch): Promise<boolean> {
    setSaving(true);

    // Snapshot for revert on failure
    const prevLead = selectedLead?.id === id ? selectedLead : null;
    const prevStatus = prevLead?.status;

    // Optimistic: update selectedLead visible fields immediately
    if (prevLead) {
      setSelectedLead((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              ...(patch.status ? { status: patch.status } : {}),
              ...(patch.quality ? { quality: patch.quality } : {}),
              ...(patch.dealValue !== undefined ? { dealValue: patch.dealValue } : {}),
              ...(patch.leadScore !== undefined ? { leadScore: patch.leadScore } : {}),
              ...(patch.company !== undefined ? { company: patch.company } : {}),
              ...(patch.expectedCloseDate !== undefined
                ? { expectedCloseDate: patch.expectedCloseDate }
                : {}),
              ...(patch.service !== undefined ? { service: patch.service } : {}),
            }
          : prev
      );
    }
    // Optimistic: update leads list visible status
    if (patch.status) {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: patch.status! } : l))
      );
    }

    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update");
      }
      const data = await res.json();
      const updated = data.lead;
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...updated } : l))
      );
      // Synthesize an activity entry when status changed (server logs it too)
      const statusChanged =
        !!patch.status && !!prevStatus && patch.status !== prevStatus;
      const optimisticActivity: LeadActivity | null = statusChanged
        ? {
            id: `tmp-status-${Date.now()}`,
            type: "status_change",
            description: `Status changed from "${prevStatus}" to "${patch.status}"`,
            actorName: user.name,
            createdAt: new Date().toISOString(),
          }
        : null;
      if (selectedLead?.id === id) {
        setSelectedLead((prev) =>
          prev
            ? {
                ...prev,
                ...updated,
                session: prev.session,
                notes: prev.notes,
                tasks: prev.tasks,
                activities: optimisticActivity
                  ? [optimisticActivity, ...prev.activities]
                  : prev.activities,
              }
            : prev
        );
      }
      toast.success("Lead updated");
      fetchStats();
      return true;
    } catch (e: any) {
      // Revert optimistic updates
      if (prevLead) {
        setSelectedLead((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                ...(patch.status && prevStatus ? { status: prevStatus } : {}),
                ...(patch.quality ? { quality: prevLead.quality } : {}),
                ...(patch.dealValue !== undefined ? { dealValue: prevLead.dealValue } : {}),
                ...(patch.leadScore !== undefined ? { leadScore: prevLead.leadScore } : {}),
                ...(patch.company !== undefined ? { company: prevLead.company } : {}),
                ...(patch.expectedCloseDate !== undefined
                  ? { expectedCloseDate: prevLead.expectedCloseDate }
                  : {}),
                ...(patch.service !== undefined ? { service: prevLead.service } : {}),
              }
            : prev
        );
      }
      if (patch.status && prevStatus) {
        setLeads((prev) =>
          prev.map((l) => (l.id === id ? { ...l, status: prevStatus } : l))
        );
      }
      toast.error(e.message || "Update failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ─── Add a note (POST /api/leads/[id]/notes) ────────────────────
  async function addNote(id: string, content: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/leads/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add note");
      }
      const data = await res.json();
      const note: LeadNote = data.note;
      const nowIso = new Date().toISOString();
      setSelectedLead((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              notes: [note, ...prev.notes],
              activities: [
                {
                  id: `tmp-note-${nowIso}`,
                  type: "note_added",
                  description: `Note added by ${user.name}`,
                  actorName: user.name,
                  createdAt: nowIso,
                },
                ...prev.activities,
              ],
            }
          : prev
      );
      toast.success("Note added");
      fetchLeads(); // background refresh to keep list in sync
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to add note");
      return false;
    }
  }

  // ─── Create a task (POST /api/leads/[id]/tasks) ─────────────────
  async function addTask(
    id: string,
    title: string,
    dueDate: string | null
  ): Promise<boolean> {
    try {
      const body: { title: string; dueDate?: string } = { title };
      if (dueDate) body.dueDate = new Date(`${dueDate}T12:00:00`).toISOString();
      const res = await fetch(`/api/leads/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create task");
      }
      const data = await res.json();
      const task: LeadTask = data.task;
      const nowIso = new Date().toISOString();
      setSelectedLead((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              tasks: [task, ...prev.tasks],
              activities: [
                {
                  id: `tmp-task-${nowIso}`,
                  type: "task_created",
                  description: `Task "${task.title}" created by ${user.name}`,
                  actorName: user.name,
                  createdAt: nowIso,
                },
                ...prev.activities,
              ],
            }
          : prev
      );
      toast.success("Task created");
      fetchLeads();
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to create task");
      return false;
    }
  }

  // ─── Toggle task completion (PATCH /api/leads/[id]/tasks/[taskId]) ─
  async function toggleTask(
    id: string,
    taskId: string,
    completed: boolean
  ): Promise<boolean> {
    const prevTasks = selectedLead?.id === id ? selectedLead.tasks : null;
    const task = prevTasks?.find((t) => t.id === taskId);
    const nowIso = new Date().toISOString();

    // Optimistic update
    setSelectedLead((prev) =>
      prev && prev.id === id
        ? {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    completed,
                    completedAt: completed ? nowIso : null,
                  }
                : t
            ),
          }
        : prev
    );

    try {
      const res = await fetch(`/api/leads/${id}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update task");
      }
      // Push synthesized activity
      if (task) {
        setSelectedLead((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                activities: [
                  {
                    id: `tmp-toggle-${nowIso}`,
                    type: completed ? "task_completed" : "task_reopened",
                    description: `Task "${task.title}" ${completed ? "completed" : "reopened"} by ${user.name}`,
                    actorName: user.name,
                    createdAt: nowIso,
                  },
                  ...prev.activities,
                ],
              }
            : prev
        );
      }
      return true;
    } catch (e: any) {
      // Revert optimistic update
      if (prevTasks) {
        setSelectedLead((prev) =>
          prev && prev.id === id ? { ...prev, tasks: prevTasks } : prev
        );
      }
      toast.error(e.message || "Failed to update task");
      return false;
    }
  }

  // ─── Delete a task (DELETE /api/leads/[id]/tasks/[taskId]) ──────
  async function deleteTask(id: string, taskId: string): Promise<boolean> {
    const prevTasks = selectedLead?.id === id ? selectedLead.tasks : null;
    // Optimistic removal
    setSelectedLead((prev) =>
      prev && prev.id === id
        ? {
            ...prev,
            tasks: prev.tasks.filter((t) => t.id !== taskId),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/leads/${id}/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete task");
      }
      toast.success("Task deleted");
      return true;
    } catch (e: any) {
      // Revert
      if (prevTasks) {
        setSelectedLead((prev) =>
          prev && prev.id === id ? { ...prev, tasks: prevTasks } : prev
        );
      }
      toast.error(e.message || "Failed to delete task");
      return false;
    }
  }

  // ─── Status change from row dropdown ───────────────────────────
  function handleStatusChange(lead: Lead, status: LeadStatus) {
    updateLead(lead.id, { status });
  }

  // ─── Delete ────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setLeads((prev) => prev.filter((l) => l.id !== id));
      toast.success("Lead deleted");
      setDeleteTarget(null);
      if (selectedLead?.id === id) {
        setDetailOpen(false);
        setSelectedLead(null);
      }
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    }
  }

  function clearFilters() {
    setSearchInput("");
    setStatusFilter("all");
    setQualityFilter("all");
  }

  // ─── Derived counts for header chips ───────────────────────────
  const newThisWeek = stats?.thisWeek ?? 0;
  const highCount = stats?.high ?? 0;
  const totalCount = stats?.total ?? leads.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="text-primary" size={22} />
            Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Capture, qualify, and convert prospects collected by your AI agent
            for{" "}
            <span className="font-medium text-foreground">{user.businessName}</span>.
          </p>
        </div>

        {/* Stat chips */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="bg-card gap-1.5 py-1 px-2.5 text-xs"
          >
            <Users size={12} className="text-primary" />
            <span className="font-semibold">{totalCount}</span> total
          </Badge>
          <Badge
            variant="outline"
            className="bg-card gap-1.5 py-1 px-2.5 text-xs"
          >
            <Sparkles size={12} className="text-primary" />
            <span className="font-semibold">{newThisWeek}</span> this week
          </Badge>
          <Badge
            variant="outline"
            className="bg-card gap-1.5 py-1 px-2.5 text-xs"
          >
            <Flame size={12} className="text-destructive" />
            <span className="font-semibold">{highCount}</span> high quality
          </Badge>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total leads"
          value={stats?.total ?? 0}
          icon={Users}
          accent="blue"
          loading={statsLoading}
        />
        <StatCard
          label="New (status)"
          value={stats?.new ?? 0}
          hint={`${newThisWeek} this week`}
          icon={Sparkles}
          accent="amber"
          loading={statsLoading}
        />
        <StatCard
          label="High quality"
          value={stats?.high ?? 0}
          icon={Flame}
          accent="rose"
          loading={statsLoading}
        />
        <StatCard
          label="Conversion rate"
          value={`${stats?.conversionRate ?? 0}%`}
          hint={`${stats?.won ?? 0} won`}
          icon={TrendingUp}
          accent="green"
          loading={statsLoading}
        />
      </div>

      {/* Toolbar */}
      <Card className="py-3">
        <CardContent className="px-3 sm:px-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search by name, email or phone…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchInput && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {formatStatus(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={qualityFilter} onValueChange={setQualityFilter}>
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue placeholder="Quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All qualities</SelectItem>
                {QUALITIES.map((q) => (
                  <SelectItem key={q} value={q} className="capitalize">
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground"
              >
                <X size={14} /> Clear
              </Button>
            )}

            {/* View toggle: List / Pipeline */}
            <div className="flex items-center rounded-lg border overflow-hidden">
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="rounded-none gap-1.5 h-8"
                title="List view"
              >
                <List size={14} />
                <span className="hidden sm:inline">List</span>
              </Button>
              <Button
                variant={viewMode === "pipeline" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("pipeline")}
                className="rounded-none gap-1.5 h-8"
                title="Pipeline board"
              >
                <LayoutGrid size={14} />
                <span className="hidden sm:inline">Pipeline</span>
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const params = new URLSearchParams();
                if (statusFilter) params.set("status", statusFilter);
                if (qualityFilter) params.set("quality", qualityFilter);
                const qs = params.toString();
                window.open(
                  `/api/leads/export${qs ? "?" + qs : ""}`,
                  "_blank"
                );
                toast.success("Exporting leads as CSV…");
              }}
              disabled={leads.length === 0}
              className="gap-1.5"
              title="Export filtered leads as CSV"
            >
              <Download size={15} />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                fetchLeads();
                fetchStats();
              }}
              disabled={loading}
              aria-label="Refresh"
            >
              <RefreshCw
                size={15}
                className={loading ? "animate-spin" : ""}
              />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline board */}
      {viewMode === "pipeline" ? (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <LayoutGrid size={15} /> Lead Pipeline
              </h3>
              <p className="text-xs text-muted-foreground">
                Drag leads between columns to update their status
              </p>
            </div>
          </div>
          <PipelineBoard businessId={user.businessId} onLeadClick={(lead) => openDetail(lead as Lead)} />
        </Card>
      ) : (
      /* List / table */
      <Card className="py-0 overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <Loader2 className="size-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading leads…</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-4">
            <EmptyState
              hasFilters={hasFilters}
              onRefresh={() => {
                fetchLeads();
                fetchStats();
              }}
              onClearFilters={clearFilters}
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block max-h-[65vh] overflow-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 min-w-[180px]">Name</TableHead>
                    <TableHead className="min-w-[200px]">Contact</TableHead>
                    <TableHead className="min-w-[140px]">Service</TableHead>
                    <TableHead className="min-w-[110px]">Quality</TableHead>
                    <TableHead className="min-w-[120px]">Status</TableHead>
                    <TableHead className="min-w-[110px]">Source</TableHead>
                    <TableHead className="min-w-[120px]">Date</TableHead>
                    <TableHead className="text-right pr-4 w-[60px]">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => {
                    const isNew = lead.status === "new";
                    return (
                      <TableRow
                        key={lead.id}
                        onClick={() => openDetail(lead)}
                        className={cn(
                          "cursor-pointer group",
                          isNew && "bg-primary/[0.035] hover:bg-primary/[0.06]"
                        )}
                      >
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8">
                              <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                                {initials(lead.name) || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate flex items-center gap-1.5">
                                <span className="truncate">{lead.name}</span>
                                {isNew && (
                                  <span className="relative flex size-1.5 shrink-0">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                    <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                                  </span>
                                )}
                              </div>
                              {lead.sessionId && (
                                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <MessageSquare size={9} />
                                  Has chat
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs space-y-0.5">
                            {lead.email ? (
                              <div className="flex items-center gap-1.5 truncate">
                                <Mail size={11} className="text-muted-foreground shrink-0" />
                                <span className="truncate">{lead.email}</span>
                              </div>
                            ) : (
                              <div className="text-muted-foreground/60">—</div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-1.5 truncate text-muted-foreground">
                                <Phone size={11} className="shrink-0" />
                                <span className="truncate">{lead.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm truncate block max-w-[180px]">
                            {lead.service || (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <QualityBadge quality={lead.quality} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={lead.status} />
                        </TableCell>
                        <TableCell>
                          <span className="text-xs capitalize text-muted-foreground">
                            {lead.source}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground">
                            {relativeTime(lead.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell
                          className="text-right pr-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <LeadRowActions
                            lead={lead}
                            onStatusChange={handleStatusChange}
                            onDelete={(l) => setDeleteTarget(l)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y max-h-[65vh] overflow-auto scroll-thin">
              {leads.map((lead) => {
                const isNew = lead.status === "new";
                return (
                  <div
                    key={lead.id}
                    onClick={() => openDetail(lead)}
                    className={cn(
                      "p-4 cursor-pointer hover:bg-muted/40 transition-colors",
                      isNew && "bg-primary/[0.035]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="size-10 shrink-0">
                        <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
                          {initials(lead.name) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate flex items-center gap-1.5">
                              <span className="truncate">{lead.name}</span>
                              {isNew && (
                                <span className="relative flex size-1.5 shrink-0">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                  <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {lead.email || lead.phone || lead.service || "—"}
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <LeadRowActions
                              lead={lead}
                              onStatusChange={handleStatusChange}
                              onDelete={(l) => setDeleteTarget(l)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <QualityBadge quality={lead.quality} />
                          <StatusBadge status={lead.status} />
                          <span className="text-[11px] text-muted-foreground ml-auto">
                            {relativeTime(lead.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer count */}
            <div className="border-t px-4 py-2.5 text-xs text-muted-foreground flex items-center justify-between bg-muted/20">
              <span>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {leads.length}
                </span>{" "}
                {leads.length === 1 ? "lead" : "leads"}
                {hasFilters && " (filtered)"}
              </span>
              {leads.length >= 200 && (
                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <ArrowUpRight size={11} /> Limit 200 reached
                </span>
              )}
            </div>
          </>
        )}
      </Card>
      )}

      {/* Detail dialog */}
      <LeadDetailDialog
        lead={selectedLead}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSave={updateLead}
        onAddNote={addNote}
        onAddTask={addTask}
        onToggleTask={toggleTask}
        onDeleteTask={deleteTask}
        onDeleted={handleDelete}
        onScoreLead={scoreLeadWithAi}
        scoring={scoring}
        saving={saving || detailLoading}
      />

      {/* Row-level delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{deleteTarget?.name}</strong> from your leads. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Delete lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
