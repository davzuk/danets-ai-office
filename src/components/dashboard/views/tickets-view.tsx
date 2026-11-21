"use client";

import * as React from "react";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  Loader2,
  Search,
  Ticket as TicketIcon,
  Plus,
  Send,
  Copy,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  MoreHorizontal,
  Trash2,
  Phone,
  Mail,
  MessageSquare,
  Inbox,
  Filter,
  X,
  RefreshCw,
  CircleDot,
  Tag,
  ExternalLink,
  UserCircle2,
  StickyNote,
  PenSquare,
  Clock,
  Flame,
  Hourglass,
  CheckCheck,
  Gauge,
  Wand2,
  CornerUpLeft,
  MessageCircle,
  Building2,
} from "lucide-react";

import {
  Card,
  CardContent,
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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface UserProp {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type TicketStatus = "open" | "pending" | "in_progress" | "resolved" | "closed";
type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketSentiment = "positive" | "neutral" | "negative" | "frustrated";
type MessageRole = "customer" | "agent";

interface TicketCategory {
  id: string;
  name: string;
  color: string;
}

interface TicketMessage {
  id: string;
  role: MessageRole;
  content: string;
  authorName: string | null;
  createdAt: string;
}

interface TicketNote {
  id: string;
  authorName: string | null;
  content: string;
  createdAt: string;
}

// Lightweight row shape returned by GET /api/tickets
interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  assignedName: string | null;
  category: TicketCategory | null;
  aiPriority: TicketPriority | null;
  aiSentiment: TicketSentiment | null;
  lastMessage: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

// Full ticket detail returned by GET /api/tickets/[id]
interface TicketDetail extends Ticket {
  assignedTo: string | null;
  categoryId: string | null;
  aiSummary: string | null;
  aiSuggestedReply: string | null;
  aiNextAction: string | null;
  chatSessionId: string | null;
  messages: TicketMessage[];
  notes: TicketNote[];
}

interface TicketStats {
  open: number;
  urgent: number;
  awaitingReply: number;
  recentlyResolved: number;
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
}

interface Category extends TicketCategory {
  description?: string | null;
  ticketCount: number;
}

const STATUSES: TicketStatus[] = [
  "open",
  "pending",
  "in_progress",
  "resolved",
  "closed",
];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

/** Title-case a snake_case string, e.g. "in_progress" → "In Progress". */
function formatStatus(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── badge styling ───────────────────────────────────────────────
function statusBadgeClass(s: TicketStatus) {
  switch (s) {
    case "open":
      return "bg-primary/10 text-primary border-primary/20";
    case "pending":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "in_progress":
      return "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30";
    case "resolved":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "closed":
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function priorityBadgeClass(p: TicketPriority) {
  switch (p) {
    case "urgent":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "high":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
    case "medium":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "low":
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function sentimentBadgeClass(s: TicketSentiment) {
  switch (s) {
    case "frustrated":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "negative":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
    case "positive":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "neutral":
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={cn("gap-1", statusBadgeClass(status))}>
      {status === "open" && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      )}
      {formatStatus(status)}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize gap-1", priorityBadgeClass(priority))}
    >
      {priority === "urgent" && <Flame size={11} />}
      {priority === "high" && <AlertCircle size={11} />}
      {priority}
    </Badge>
  );
}

function SentimentBadge({ sentiment }: { sentiment: TicketSentiment }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize gap-1", sentimentBadgeClass(sentiment))}
    >
      {sentiment === "frustrated" && <AlertCircle size={11} />}
      {sentiment === "positive" && <CheckCircle2 size={11} />}
      {sentiment}
    </Badge>
  );
}

function CategoryBadge({ category }: { category: TicketCategory | null }) {
  if (!category) return null;
  return (
    <Badge variant="outline" className="gap-1.5 bg-card">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: category.color || "#64748b" }}
      />
      {category.name}
    </Badge>
  );
}

// ─── date helpers ────────────────────────────────────────────────
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
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

function fullDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string | null): string {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
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
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
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
            <Skeleton className="h-6 w-12 mt-0.5" />
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

// ─── Ticket patch payload ────────────────────────────────────────
type TicketPatch = {
  status?: TicketStatus;
  priority?: TicketPriority;
  categoryId?: string | null;
  assignedTo?: string | null;
  assignedName?: string | null;
  subject?: string;
};

// ─── AI result payload (returned by /api/tickets/[id]/ai) ────────
interface AiResult {
  aiSummary?: string | null;
  aiSuggestedReply?: string | null;
  aiPriority?: TicketPriority | null;
  aiSentiment?: TicketSentiment | null;
  aiPriorityReason?: string | null;
  aiNextAction?: string | null;
  error?: string;
}

// ─── Detail Dialog ───────────────────────────────────────────────
function TicketDetailDialog({
  ticket,
  open,
  onOpenChange,
  onSave,
  onAddMessage,
  onAddNote,
  onRunAi,
  onDeleted,
  saving,
  categories,
}: {
  ticket: TicketDetail | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (id: string, patch: TicketPatch) => Promise<boolean>;
  onAddMessage: (id: string, content: string) => Promise<boolean>;
  onAddNote: (id: string, content: string) => Promise<boolean>;
  onRunAi: (id: string, action: "summary" | "suggest_reply" | "detect_priority" | "full_analysis") => Promise<AiResult | null>;
  onDeleted: (id: string) => void;
  saving: boolean;
  categories: Category[];
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("messages");

  // Subject editor (editable in header)
  const [subjectDraft, setSubjectDraft] = React.useState("");
  const [subjectDirty, setSubjectDirty] = React.useState(false);

  // Sync subject draft when ticket changes
  React.useEffect(() => {
    if (ticket) {
      setSubjectDraft(ticket.subject);
      setSubjectDirty(false);
    }
  }, [ticket?.id, ticket?.subject]);

  // Reset transient state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setActiveTab("messages");
    }
  }, [open]);

  if (!ticket) return null;

  const isOpen = ticket.status === "open";

  async function commitSubject() {
    if (!subjectDirty) return;
    const trimmed = subjectDraft.trim();
    if (!trimmed || trimmed === ticket!.subject) {
      setSubjectDirty(false);
      return;
    }
    const ok = await onSave(ticket!.id, { subject: trimmed });
    if (!ok) {
      setSubjectDraft(ticket!.subject);
    }
    setSubjectDirty(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <Avatar className="size-11 shrink-0">
              <AvatarFallback className="brand-gradient text-white font-semibold">
                {initials(ticket.customerName) || <TicketIcon size={18} />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <Input
                  value={subjectDraft}
                  onChange={(e) => {
                    setSubjectDraft(e.target.value);
                    setSubjectDirty(true);
                  }}
                  onBlur={commitSubject}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      setSubjectDraft(ticket.subject);
                      setSubjectDirty(false);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className={cn(
                    "h-7 px-1.5 text-base font-semibold border-transparent hover:border-border focus-visible:border-primary bg-transparent",
                    !subjectDirty && "border-transparent"
                  )}
                />
                {isOpen && (
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2 flex-wrap mt-1">
                <PriorityBadge priority={ticket.priority} />
                <StatusBadge status={ticket.status} />
                <CategoryBadge category={ticket.category} />
                {ticket.aiSentiment && (
                  <SentimentBadge sentiment={ticket.aiSentiment} />
                )}
              </DialogDescription>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <UserCircle2 size={12} />
                <span className="truncate">
                  {ticket.customerName || "Anonymous"}
                </span>
                <span className="text-muted-foreground/50">·</span>
                <Clock size={11} />
                {relativeTime(ticket.createdAt)}
              </div>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="messages" className="flex-1 gap-1.5">
              <MessageCircle size={13} />
              <span className="hidden sm:inline">Messages</span>
              {ticket.messages.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 min-w-4 justify-center">
                  {ticket.messages.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex-1 gap-1.5">
              <StickyNote size={13} />
              <span className="hidden sm:inline">Notes</span>
              {ticket.notes.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 min-w-4 justify-center">
                  {ticket.notes.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex-1 gap-1.5">
              <Sparkles size={13} />
              <span className="hidden sm:inline">AI Assistant</span>
            </TabsTrigger>
            <TabsTrigger value="details" className="flex-1 gap-1.5">
              <CircleDot size={13} />
              <span className="hidden sm:inline">Details</span>
            </TabsTrigger>
          </TabsList>

          {/* ─── Messages tab ─── */}
          <TabsContent value="messages" className="mt-4">
            <MessagesTab
              ticket={ticket}
              onAddMessage={onAddMessage}
              saving={saving}
            />
          </TabsContent>

          {/* ─── Notes tab ─── */}
          <TabsContent value="notes" className="mt-4">
            <NotesTab
              ticket={ticket}
              onAddNote={onAddNote}
              saving={saving}
            />
          </TabsContent>

          {/* ─── AI Assistant tab ─── */}
          <TabsContent value="ai" className="mt-4">
            <AiAssistantTab
              ticket={ticket}
              onRunAi={onRunAi}
              onAddMessage={onAddMessage}
            />
          </TabsContent>

          {/* ─── Details tab ─── */}
          <TabsContent value="details" className="mt-4 space-y-4">
            <DetailsTab
              ticket={ticket}
              onSave={onSave}
              saving={saving}
              categories={categories}
              onMarkResolved={() =>
                onSave(ticket.id, { status: "resolved" })
              }
              onDelete={() => setConfirmDelete(true)}
            />
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
            <AlertDialogTitle>Delete this ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{ticket.subject}</strong> and all its messages, notes, and
              AI data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                onDeleted(ticket.id);
                setConfirmDelete(false);
              }}
            >
              Delete ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ─── Messages tab (chat bubbles) ─────────────────────────────────
function MessagesTab({
  ticket,
  onAddMessage,
  saving,
}: {
  ticket: TicketDetail;
  onAddMessage: (id: string, content: string) => Promise<boolean>;
  saving: boolean;
}) {
  const [content, setContent] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [ticket.messages.length, ticket.id]);

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const ok = await onAddMessage(ticket.id, trimmed);
    setSubmitting(false);
    if (ok) setContent("");
  }

  if (ticket.messages.length === 0 && !ticket.description) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center">
        <MessageSquare className="mx-auto text-muted-foreground/60" size={22} />
        <p className="text-sm text-muted-foreground mt-2">No messages yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Send the first reply below to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        className="max-h-[45vh] overflow-y-auto scroll-thin space-y-3 pr-1"
      >
        {ticket.messages.map((m) => {
          const isAgent = m.role === "agent";
          return (
            <div
              key={m.id}
              className={cn(
                "flex items-end gap-2.5",
                isAgent && "flex-row-reverse"
              )}
            >
              <Avatar className="size-7 shrink-0">
                <AvatarFallback
                  className={cn(
                    "text-[10px] font-semibold",
                    isAgent
                      ? "brand-gradient text-white"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {isAgent ? (
                    <Building2 size={13} />
                  ) : (
                    initials(m.authorName) || <UserCircle2 size={13} />
                  )}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2",
                  isAgent
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                )}
              >
                <div
                  className={cn(
                    "text-[11px] mb-0.5 flex items-center gap-1.5",
                    isAgent
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground"
                  )}
                >
                  <span className="font-medium truncate">
                    {m.authorName || (isAgent ? "Agent" : "Customer")}
                  </span>
                  <span>·</span>
                  <span>{relativeTime(m.createdAt)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                  {m.content}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <Separator />

      <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2">
        <Label className="text-xs gap-1.5 text-foreground font-medium sr-only">
          <Send size={12} />
          Reply as agent
        </Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type your reply to the customer…"
          rows={3}
          maxLength={10000}
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
            ⌘/Ctrl+Enter to send · Posted as{" "}
            <span className="font-medium text-foreground">Agent</span>
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
              <Send size={13} />
            )}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Notes tab ───────────────────────────────────────────────────
function NotesTab({
  ticket,
  onAddNote,
  saving,
}: {
  ticket: TicketDetail;
  onAddNote: (id: string, content: string) => Promise<boolean>;
  saving: boolean;
}) {
  const [content, setContent] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const ok = await onAddNote(ticket.id, trimmed);
    setSubmitting(false);
    if (ok) setContent("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
        <Label className="text-xs gap-1.5 text-foreground font-medium">
          <PenSquare size={12} className="text-primary" />
          Add an internal note
        </Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Internal note — visible only to your team, not the customer…"
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
        {ticket.notes.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <StickyNote className="mx-auto text-muted-foreground/60" size={20} />
            <p className="text-sm text-muted-foreground mt-2">No notes yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Capture internal context, troubleshooting steps, or handoff notes.
            </p>
          </div>
        ) : (
          ticket.notes.map((note) => (
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
                      {note.authorName || "Unknown"}
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

// ─── AI Assistant tab ────────────────────────────────────────────
function AiAssistantTab({
  ticket,
  onRunAi,
  onAddMessage,
}: {
  ticket: TicketDetail;
  onRunAi: (id: string, action: "summary" | "suggest_reply" | "detect_priority" | "full_analysis") => Promise<AiResult | null>;
  onAddMessage: (id: string, content: string) => Promise<boolean>;
}) {
  // Local copies of stored AI values (updated when AI runs succeed)
  const [summary, setSummary] = React.useState<string | null>(ticket.aiSummary);
  const [suggestedReply, setSuggestedReply] = React.useState<string | null>(
    ticket.aiSuggestedReply
  );
  const [priority, setPriority] = React.useState<TicketPriority | null>(
    ticket.aiPriority
  );
  const [sentiment, setSentiment] = React.useState<TicketSentiment | null>(
    ticket.aiSentiment
  );
  const [priorityReason, setPriorityReason] = React.useState<string | null>(
    null
  );
  const [nextAction, setNextAction] = React.useState<string | null>(
    ticket.aiNextAction
  );

  // Sync local state when ticket changes (e.g. opening a different ticket)
  React.useEffect(() => {
    setSummary(ticket.aiSummary);
    setSuggestedReply(ticket.aiSuggestedReply);
    setPriority(ticket.aiPriority);
    setSentiment(ticket.aiSentiment);
    setPriorityReason(null);
    setNextAction(ticket.aiNextAction);
  }, [
    ticket.id,
    ticket.aiSummary,
    ticket.aiSuggestedReply,
    ticket.aiPriority,
    ticket.aiSentiment,
    ticket.aiNextAction,
  ]);

  // Track which action is loading
  const [loadingAction, setLoadingAction] = React.useState<string | null>(null);
  const [sendingReply, setSendingReply] = React.useState(false);

  async function run(
    action: "summary" | "suggest_reply" | "detect_priority" | "full_analysis"
  ) {
    setLoadingAction(action);
    try {
      const result = await onRunAi(ticket.id, action);
      if (!result) return;
      if (result.error) {
        toast.error(result.error);
        return;
      }
      // Merge returned fields into local state
      if (result.aiSummary !== undefined) setSummary(result.aiSummary ?? null);
      if (result.aiSuggestedReply !== undefined)
        setSuggestedReply(result.aiSuggestedReply ?? null);
      if (result.aiPriority !== undefined)
        setPriority(result.aiPriority ?? null);
      if (result.aiSentiment !== undefined)
        setSentiment(result.aiSentiment ?? null);
      if (result.aiPriorityReason !== undefined)
        setPriorityReason(result.aiPriorityReason ?? null);
      if (result.aiNextAction !== undefined)
        setNextAction(result.aiNextAction ?? null);
      toast.success("AI analysis complete");
    } finally {
      setLoadingAction(null);
    }
  }

  async function copyReply() {
    if (!suggestedReply) return;
    try {
      await navigator.clipboard.writeText(suggestedReply);
      toast.success("Copied reply to clipboard");
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  async function sendAsReply() {
    if (!suggestedReply?.trim()) return;
    setSendingReply(true);
    try {
      const ok = await onAddMessage(ticket.id, suggestedReply.trim());
      if (ok) toast.success("Reply sent to customer");
    } finally {
      setSendingReply(false);
    }
  }

  const actionBtns: {
    action: "summary" | "suggest_reply" | "detect_priority" | "full_analysis";
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    hint: string;
  }[] = [
    {
      action: "summary",
      label: "Generate Summary",
      icon: Sparkles,
      hint: "2-3 sentence overview of the issue",
    },
    {
      action: "suggest_reply",
      label: "Suggest Reply",
      icon: CornerUpLeft,
      hint: "Draft a professional reply",
    },
    {
      action: "detect_priority",
      label: "Detect Priority",
      icon: Gauge,
      hint: "Assess priority + sentiment",
    },
    {
      action: "full_analysis",
      label: "Full Analysis",
      icon: Wand2,
      hint: "Summary + reply + priority + next step",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {actionBtns.map((b) => {
          const isLoading = loadingAction === b.action;
          return (
            <Button
              key={b.action}
              variant="outline"
              className="h-auto justify-start gap-3 py-3 px-3.5"
              onClick={() => run(b.action)}
              disabled={!!loadingAction}
            >
              <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <b.icon size={16} />
                )}
              </div>
              <div className="text-left min-w-0">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {b.label}
                  {b.action === "full_analysis" && (
                    <Sparkles size={11} className="text-primary" />
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {b.hint}
                </div>
              </div>
            </Button>
          );
        })}
      </div>

      {/* Results */}
      <div className="space-y-3">
        {/* AI Summary */}
        <AiResultCard
          title="AI Summary"
          icon={Sparkles}
          empty="No summary yet — click “Generate Summary” above."
          loading={loadingAction === "summary" || loadingAction === "full_analysis"}
          value={summary}
        />

        {/* Suggested Reply */}
        <div className="rounded-lg border border-primary/15 bg-primary/[0.03] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs gap-1.5 text-foreground font-semibold">
              <CornerUpLeft size={12} className="text-primary" />
              Suggested Reply
            </Label>
            {suggestedReply && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={copyReply}
              >
                <Copy size={12} />
                Copy
              </Button>
            )}
          </div>
          {(loadingAction === "suggest_reply" ||
            loadingAction === "full_analysis") &&
          !suggestedReply ? (
            <Skeleton className="h-20 w-full" />
          ) : suggestedReply ? (
            <>
              <Textarea
                value={suggestedReply}
                onChange={(e) => setSuggestedReply(e.target.value)}
                rows={5}
                className="resize-y bg-card"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertCircle size={11} />
                  Review and edit before sending — AI replies are not auto-sent.
                </p>
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1.5"
                  onClick={sendAsReply}
                  disabled={sendingReply || !suggestedReply.trim()}
                >
                  {sendingReply ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Send size={12} />
                  )}
                  Send as reply
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No suggested reply yet — click “Suggest Reply” above.
            </p>
          )}
        </div>

        {/* Detected Priority */}
        <div className="rounded-lg border bg-card p-3.5 space-y-2">
          <Label className="text-xs gap-1.5 text-foreground font-semibold">
            <Gauge size={12} className="text-primary" />
            Detected Priority & Sentiment
          </Label>
          {loadingAction === "detect_priority" ||
          loadingAction === "full_analysis" ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ) : priority || sentiment ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {priority && <PriorityBadge priority={priority} />}
                {sentiment && <SentimentBadge sentiment={sentiment} />}
                {ticket.priority !== priority && priority && (
                  <Badge
                    variant="outline"
                    className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1"
                  >
                    <AlertCircle size={11} />
                    Differs from current ({ticket.priority})
                  </Badge>
                )}
              </div>
              {priorityReason && (
                <p className="text-sm text-muted-foreground italic">
                  “{priorityReason}”
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No analysis yet — click “Detect Priority” above.
            </p>
          )}
        </div>

        {/* Next Action */}
        <AiResultCard
          title="Recommended Next Action"
          icon={CheckCircle2}
          empty="No recommendation yet — run “Full Analysis” to generate."
          loading={loadingAction === "full_analysis"}
          value={nextAction}
        />
      </div>
    </div>
  );
}

function AiResultCard({
  title,
  icon: Icon,
  value,
  empty,
  loading,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: string | null;
  empty: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3.5 space-y-2">
      <Label className="text-xs gap-1.5 text-foreground font-semibold">
        <Icon size={12} className="text-primary" />
        {title}
      </Label>
      {loading && !value ? (
        <Skeleton className="h-12 w-full" />
      ) : value ? (
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
          {value}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

// ─── Details tab ─────────────────────────────────────────────────
function DetailsTab({
  ticket,
  onSave,
  saving,
  categories,
  onMarkResolved,
  onDelete,
}: {
  ticket: TicketDetail;
  onSave: (id: string, patch: TicketPatch) => Promise<boolean>;
  saving: boolean;
  categories: Category[];
  onMarkResolved: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      {/* Controls */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            Status
          </Label>
          <Select
            value={ticket.status}
            onValueChange={(v) =>
              onSave(ticket.id, { status: v as TicketStatus })
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
            Priority
          </Label>
          <Select
            value={ticket.priority}
            onValueChange={(v) =>
              onSave(ticket.id, { priority: v as TicketPriority })
            }
            disabled={saving}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            Category
          </Label>
          <Select
            value={ticket.categoryId || "__none__"}
            onValueChange={(v) =>
              onSave(ticket.id, {
                categoryId: v === "__none__" ? null : v,
              })
            }
            disabled={saving}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No category</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Quick action */}
      {ticket.status !== "resolved" && ticket.status !== "closed" && (
        <Button
          variant="default"
          size="sm"
          onClick={onMarkResolved}
          disabled={saving}
          className="gap-1.5 w-full"
        >
          <CheckCircle2 size={14} />
          Mark as Resolved
        </Button>
      )}

      <Separator />

      {/* Customer info */}
      <div>
        <Label className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 block">
          Customer
        </Label>
        <div className="grid sm:grid-cols-2 gap-3">
          <InfoRow
            icon={UserCircle2}
            label="Name"
            value={ticket.customerName || "Anonymous"}
          />
          <InfoRow
            icon={Tag}
            label="Category"
            value={
              ticket.category ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: ticket.category.color || "#64748b",
                    }}
                  />
                  {ticket.category.name}
                </span>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            icon={Mail}
            label="Email"
            value={ticket.customerEmail || "—"}
            href={ticket.customerEmail ? `mailto:${ticket.customerEmail}` : undefined}
          />
          <InfoRow
            icon={Phone}
            label="Phone"
            value={ticket.customerPhone || "—"}
            href={ticket.customerPhone ? `tel:${ticket.customerPhone}` : undefined}
          />
        </div>
      </div>

      <Separator />

      {/* Assignment */}
      <div>
        <Label className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 block">
          Assignment
        </Label>
        <InfoRow
          icon={Building2}
          label="Assigned to"
          value={ticket.assignedName || "Unassigned"}
        />
      </div>

      <Separator />

      {/* Timestamps */}
      <div>
        <Label className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 block">
          Timestamps
        </Label>
        <div className="grid sm:grid-cols-2 gap-3">
          <InfoRow
            icon={Clock}
            label="Created"
            value={<span className="text-xs">{fullDate(ticket.createdAt)}</span>}
          />
          <InfoRow
            icon={RefreshCw}
            label="Updated"
            value={<span className="text-xs">{fullDate(ticket.updatedAt)}</span>}
          />
          <InfoRow
            icon={CheckCircle2}
            label="Resolved"
            value={
              ticket.resolvedAt ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {fullDate(ticket.resolvedAt)}
                </span>
              ) : (
                <span className="text-muted-foreground">Not resolved</span>
              )
            }
          />
          <InfoRow
            icon={MessageSquare}
            label="Last message"
            value={
              <span className="text-xs">
                {ticket.lastMessageAt
                  ? relativeTime(ticket.lastMessageAt)
                  : "—"}
              </span>
            }
          />
        </div>
      </div>

      <Separator />

      {/* Description (initial customer message) */}
      {ticket.description && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <MessageSquare size={12} /> Original description
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">
            {ticket.description}
          </p>
        </div>
      )}

      {ticket.chatSessionId && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ExternalLink size={12} />
          Linked to chat session — open the Conversations view for the full transcript.
        </p>
      )}

      <Separator />

      {/* Delete */}
      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={saving}
        className="gap-1.5 w-full sm:w-auto"
      >
        <Trash2 size={14} />
        Delete ticket
      </Button>
    </>
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

// ─── New Ticket Dialog ───────────────────────────────────────────
function NewTicketDialog({
  open,
  onOpenChange,
  onCreate,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (data: {
    subject: string;
    description: string;
    categoryId?: string | null;
    priority: TicketPriority;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  }) => Promise<boolean>;
  categories: Category[];
}) {
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string>("__none__");
  const [priority, setPriority] = React.useState<TicketPriority>("medium");
  const [customerName, setCustomerName] = React.useState("");
  const [customerEmail, setCustomerEmail] = React.useState("");
  const [customerPhone, setCustomerPhone] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Reset on close
  React.useEffect(() => {
    if (!open) {
      setSubject("");
      setDescription("");
      setCategoryId("__none__");
      setPriority("medium");
      setCustomerName("");
      setCustomerEmail("");
      setCustomerPhone("");
    }
  }, [open]);

  const valid = subject.trim().length >= 2 && description.trim().length >= 1;

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    const ok = await onCreate({
      subject: subject.trim(),
      description: description.trim(),
      categoryId: categoryId === "__none__" ? null : categoryId,
      priority,
      customerName: customerName.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
    });
    setSubmitting(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus size={18} className="text-primary" />
            New Support Ticket
          </DialogTitle>
          <DialogDescription>
            Create a ticket manually. A customer message will be created from
            the description.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-subject">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="t-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary of the issue…"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="t-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the customer's issue or request in detail…"
              rows={5}
              maxLength={10000}
            />
            <div className="text-[11px] text-muted-foreground text-right">
              {description.length}/10000
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="t-category" className="w-full">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: c.color || "#64748b" }}
                        />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TicketPriority)}
              >
                <SelectTrigger id="t-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div>
            <Label className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 block">
              Customer (optional)
            </Label>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-name" className="text-xs text-muted-foreground">
                  Name
                </Label>
                <Input
                  id="t-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Jane Doe"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-email" className="text-xs text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="t-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-phone" className="text-xs text-muted-foreground">
                  Phone
                </Label>
                <Input
                  id="t-phone"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+1 555 0100"
                  maxLength={40}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || submitting}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ticket row card ─────────────────────────────────────────────
function TicketRowCard({
  ticket,
  onOpen,
  onQuickStatus,
  onQuickDelete,
}: {
  ticket: Ticket;
  onOpen: (t: Ticket) => void;
  onQuickStatus: (t: Ticket, status: TicketStatus) => void;
  onQuickDelete: (t: Ticket) => void;
}) {
  const isOpen = ticket.status === "open";
  return (
    <div
      onClick={() => onOpen(ticket)}
      className={cn(
        "rounded-lg border bg-card p-3.5 cursor-pointer hover:bg-muted/30 hover:border-primary/30 transition-colors group",
        isOpen && "border-primary/30 bg-primary/[0.03]"
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar className="size-9 shrink-0 mt-0.5">
          <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
            {initials(ticket.customerName) || <TicketIcon size={15} />}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate flex items-center gap-1.5">
                <span className="truncate">{ticket.subject}</span>
                {isOpen && (
                  <span className="relative flex size-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {ticket.customerName || "Anonymous"}
                {ticket.customerEmail && (
                  <>
                    <span className="text-muted-foreground/50"> · </span>
                    {ticket.customerEmail}
                  </>
                )}
              </div>
            </div>
            <div
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Ticket actions"
                  >
                    <MoreHorizontal size={15} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuLabel>Quick status</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => onQuickStatus(ticket, "in_progress")}
                    disabled={ticket.status === "in_progress"}
                  >
                    <CircleDot size={14} /> Mark in progress
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onQuickStatus(ticket, "pending")}
                    disabled={ticket.status === "pending"}
                  >
                    <Hourglass size={14} /> Mark awaiting reply
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onQuickStatus(ticket, "resolved")}
                    disabled={ticket.status === "resolved"}
                  >
                    <CheckCheck size={14} className="text-emerald-600" /> Mark resolved
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onQuickStatus(ticket, "closed")}
                    disabled={ticket.status === "closed"}
                  >
                    <X size={14} /> Close ticket
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onQuickDelete(ticket)}
                  >
                    <Trash2 size={14} /> Delete ticket
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Last message preview */}
          {ticket.lastMessage && (
            <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-1">
              <MessageSquare size={10} className="inline mr-1 -mt-0.5" />
              {ticket.lastMessage}
            </p>
          )}

          {/* Badges */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            {ticket.category && <CategoryBadge category={ticket.category} />}
            {ticket.aiSentiment && (
              <SentimentBadge sentiment={ticket.aiSentiment} />
            )}
            <span className="text-[11px] text-muted-foreground ml-auto flex items-center gap-1">
              <Clock size={11} />
              {relativeTime(ticket.lastMessageAt || ticket.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
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
      <div className="mx-auto size-14 rounded-full bg-primary/10 flex items-center justify-center">
        <Inbox className="text-primary" size={26} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">
        {hasFilters ? "No matching tickets" : "No tickets yet"}
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-md mx-auto">
        {hasFilters
          ? "Try adjusting or clearing your filters to see more tickets."
          : "Support tickets will appear here. Create one manually or have your AI chatbot escalate a conversation."}
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

// ─── Skeleton list ───────────────────────────────────────────────
function TicketListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="p-3.5">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex gap-2 mt-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────
export function TicketsView({ user }: { user: UserProp }) {
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState<TicketStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(true);
  const [categories, setCategories] = React.useState<Category[]>([]);

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [priorityFilter, setPriorityFilter] = React.useState<string>("all");

  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedTicket, setSelectedTicket] = React.useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Ticket | null>(null);

  // ─── Debounce search input ─────────────────────────────────────
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 350);
  React.useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch]);

  const hasFilters =
    !!search || statusFilter !== "all" || priorityFilter !== "all";

  // ─── Fetch list ────────────────────────────────────────────────
  const fetchTickets = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      const res = await fetch(`/api/tickets?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter]);

  React.useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // ─── Fetch stats ───────────────────────────────────────────────
  const fetchStats = React.useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/tickets/stats", { cache: "no-store" });
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

  // ─── Fetch categories (once) ───────────────────────────────────
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/tickets/categories", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setCategories(data.categories || []);
      } catch {
        /* silent */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // ─── Open detail dialog ────────────────────────────────────────
  async function openDetail(ticket: Ticket) {
    // Seed with list-row data so the dialog renders instantly
    setSelectedTicket({
      ...ticket,
      assignedTo: null,
      categoryId: ticket.category?.id || null,
      aiSummary: null,
      aiSuggestedReply: null,
      aiNextAction: null,
      chatSessionId: null,
      messages: [],
      notes: [],
    });
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load ticket");
      const data = await res.json();
      setSelectedTicket(data.ticket);
    } catch {
      toast.error("Failed to load ticket details");
    } finally {
      setDetailLoading(false);
    }
  }

  // ─── Save (PATCH) — optimistic with revert ─────────────────────
  async function updateTicket(
    id: string,
    patch: TicketPatch
  ): Promise<boolean> {
    setSaving(true);

    const prevTicket = selectedTicket?.id === id ? selectedTicket : null;
    const prevStatus = prevTicket?.status;
    const prevPriority = prevTicket?.priority;
    const prevCategoryId = prevTicket?.categoryId;
    const prevSubject = prevTicket?.subject;

    // Optimistic: update dialog
    if (prevTicket) {
      setSelectedTicket((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              ...(patch.status ? { status: patch.status } : {}),
              ...(patch.priority ? { priority: patch.priority } : {}),
              ...(patch.categoryId !== undefined
                ? {
                    categoryId: patch.categoryId,
                    category:
                      patch.categoryId === null
                        ? null
                        : categories.find((c) => c.id === patch.categoryId) ||
                          prev.category,
                  }
                : {}),
              ...(patch.subject ? { subject: patch.subject } : {}),
              ...(patch.status === "resolved" && !prev.resolvedAt
                ? { resolvedAt: new Date().toISOString() }
                : {}),
              ...(patch.status && patch.status !== "resolved"
                ? { resolvedAt: null }
                : {}),
            }
          : prev
      );
    }
    // Optimistic: update list rows
    setTickets((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              ...(patch.status ? { status: patch.status } : {}),
              ...(patch.priority ? { priority: patch.priority } : {}),
              ...(patch.categoryId !== undefined
                ? {
                    category:
                      patch.categoryId === null
                        ? null
                        : categories.find((c) => c.id === patch.categoryId) ||
                          t.category,
                  }
                : {}),
              ...(patch.subject ? { subject: patch.subject } : {}),
            }
          : t
      )
    );

    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update");
      }
      const data = await res.json();
      const updated = data.ticket;
      // Merge server-confirmed fields back
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updated } : t))
      );
      if (selectedTicket?.id === id) {
        setSelectedTicket((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                ...updated,
                messages: prev.messages,
                notes: prev.notes,
              }
            : prev
        );
      }
      toast.success("Ticket updated");
      fetchStats();
      return true;
    } catch (e: any) {
      // Revert
      if (prevTicket) {
        setSelectedTicket((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                status: prevStatus ?? prev.status,
                priority: prevPriority ?? prev.priority,
                categoryId: prevCategoryId ?? prev.categoryId,
                category: prevTicket.category,
                subject: prevSubject ?? prev.subject,
                resolvedAt: prevTicket.resolvedAt,
              }
            : prev
        );
      }
      setTickets((prev) =>
        prev.map((t) =>
          t.id === id && prevTicket
            ? {
                ...t,
                status: prevStatus ?? t.status,
                priority: prevPriority ?? t.priority,
                category: prevTicket.category,
                subject: prevSubject ?? t.subject,
              }
            : t
        )
      );
      toast.error(e.message || "Update failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ─── Add agent message ─────────────────────────────────────────
  async function addMessage(id: string, content: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "agent", content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send reply");
      }
      const data = await res.json();
      const message: TicketMessage = data.message;
      const nowIso = new Date().toISOString();
      setSelectedTicket((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              // Server auto-flips open → pending on agent reply
              status: prev.status === "open" ? "pending" : prev.status,
              messages: [...prev.messages, message],
              lastMessage: content.slice(0, 100),
              lastMessageAt: nowIso,
              updatedAt: nowIso,
            }
          : prev
      );
      setTickets((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: t.status === "open" ? "pending" : t.status,
                lastMessage: content.slice(0, 100),
                lastMessageAt: nowIso,
                updatedAt: nowIso,
              }
            : t
        )
      );
      toast.success("Reply sent");
      fetchStats();
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to send reply");
      return false;
    }
  }

  // ─── Add internal note ─────────────────────────────────────────
  async function addNote(id: string, content: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/tickets/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add note");
      }
      const data = await res.json();
      const note: TicketNote = data.note;
      setSelectedTicket((prev) =>
        prev && prev.id === id
          ? { ...prev, notes: [note, ...prev.notes] }
          : prev
      );
      toast.success("Note added");
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to add note");
      return false;
    }
  }

  // ─── Run AI action ─────────────────────────────────────────────
  async function runAi(
    id: string,
    action: "summary" | "suggest_reply" | "detect_priority" | "full_analysis"
  ): Promise<AiResult | null> {
    try {
      const res = await fetch(`/api/tickets/${id}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "AI request failed");
      }
      const data = await res.json();
      const result: AiResult = data.result || {};
      // Sync selectedTicket with persisted AI fields
      setSelectedTicket((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              ...(result.aiSummary !== undefined
                ? { aiSummary: result.aiSummary }
                : {}),
              ...(result.aiSuggestedReply !== undefined
                ? { aiSuggestedReply: result.aiSuggestedReply }
                : {}),
              ...(result.aiPriority !== undefined
                ? { aiPriority: result.aiPriority }
                : {}),
              ...(result.aiSentiment !== undefined
                ? { aiSentiment: result.aiSentiment }
                : {}),
              ...(result.aiNextAction !== undefined
                ? { aiNextAction: result.aiNextAction }
                : {}),
            }
          : prev
      );
      // Sync list rows for visible AI badges
      if (result.aiPriority !== undefined || result.aiSentiment !== undefined) {
        setTickets((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...(result.aiPriority !== undefined
                    ? { aiPriority: result.aiPriority }
                    : {}),
                  ...(result.aiSentiment !== undefined
                    ? { aiSentiment: result.aiSentiment }
                    : {}),
                }
              : t
          )
        );
      }
      return result;
    } catch (e: any) {
      toast.error(e.message || "AI request failed");
      return null;
    }
  }

  // ─── Create ticket ─────────────────────────────────────────────
  async function createTicket(data: {
    subject: string;
    description: string;
    categoryId?: string | null;
    priority: TicketPriority;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  }): Promise<boolean> {
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create ticket");
      }
      toast.success("Ticket created");
      fetchTickets();
      fetchStats();
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to create ticket");
      return false;
    }
  }

  // ─── Delete ────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setTickets((prev) => prev.filter((t) => t.id !== id));
      toast.success("Ticket deleted");
      setDeleteTarget(null);
      if (selectedTicket?.id === id) {
        setDetailOpen(false);
        setSelectedTicket(null);
      }
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    }
  }

  function clearFilters() {
    setSearchInput("");
    setStatusFilter("all");
    setPriorityFilter("all");
  }

  function handleQuickStatus(t: Ticket, status: TicketStatus) {
    updateTicket(t.id, { status });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TicketIcon className="text-primary" size={22} />
            Support Tickets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Triage, reply to, and resolve customer support requests for{" "}
            <span className="font-medium text-foreground">
              {user.businessName}
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus size={15} />
            New Ticket
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              fetchTickets();
              fetchStats();
            }}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Open"
          value={stats?.open ?? 0}
          hint="Open + in progress"
          icon={TicketIcon}
          accent="blue"
          loading={statsLoading}
        />
        <StatCard
          label="Urgent"
          value={stats?.urgent ?? 0}
          hint="Not closed"
          icon={Flame}
          accent="rose"
          loading={statsLoading}
        />
        <StatCard
          label="Awaiting Reply"
          value={stats?.awaitingReply ?? 0}
          hint="Pending customer"
          icon={Hourglass}
          accent="amber"
          loading={statsLoading}
        />
        <StatCard
          label="Recently Resolved"
          value={stats?.recentlyResolved ?? 0}
          hint="Last 7 days"
          icon={CheckCheck}
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
              placeholder="Search by subject, customer name or email…"
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

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p}
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
          </div>
        </CardContent>
      </Card>

      {/* Ticket list */}
      {loading && tickets.length === 0 ? (
        <TicketListSkeleton />
      ) : tickets.length === 0 ? (
        <EmptyState
          hasFilters={hasFilters}
          onRefresh={() => {
            fetchTickets();
            fetchStats();
          }}
          onClearFilters={clearFilters}
        />
      ) : (
        <div className="space-y-2.5 max-h-[65vh] overflow-y-auto scroll-thin pr-1">
          {loading && tickets.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Refreshing…
            </div>
          )}
          {tickets.map((ticket) => (
            <TicketRowCard
              key={ticket.id}
              ticket={ticket}
              onOpen={openDetail}
              onQuickStatus={handleQuickStatus}
              onQuickDelete={(t) => setDeleteTarget(t)}
            />
          ))}
          {/* Footer count */}
          <div className="text-xs text-muted-foreground pt-1 pb-2 px-1">
            Showing{" "}
            <span className="font-medium text-foreground">
              {tickets.length}
            </span>{" "}
            {tickets.length === 1 ? "ticket" : "tickets"}
            {hasFilters && " (filtered)"}
            {tickets.length >= 200 && (
              <span className="text-amber-600 dark:text-amber-400 ml-2">
                · Limit 200 reached
              </span>
            )}
          </div>
        </div>
      )}

      {/* New ticket dialog */}
      <NewTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createTicket}
        categories={categories}
      />

      {/* Detail dialog */}
      <TicketDetailDialog
        ticket={selectedTicket}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSave={updateTicket}
        onAddMessage={addMessage}
        onAddNote={addNote}
        onRunAi={runAi}
        onDeleted={handleDelete}
        saving={saving || detailLoading}
        categories={categories}
      />

      {/* Row-level delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{deleteTarget?.subject}</strong> and all its messages,
              notes, and AI data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Delete ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
