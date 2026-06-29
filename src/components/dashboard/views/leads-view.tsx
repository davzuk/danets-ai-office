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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface UserProp {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";
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

const STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "won", "lost"];
const QUALITIES: LeadQuality[] = ["low", "medium", "high"];

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
      className={cn("capitalize gap-1", statusBadgeClass(status))}
    >
      {status === "new" && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      )}
      {status}
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

// ─── Detail Dialog ───────────────────────────────────────────────
function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
  onSave,
  onDeleted,
  saving,
}: {
  lead: LeadDetail | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (id: string, patch: { status?: LeadStatus; quality?: LeadQuality }) => Promise<boolean>;
  onDeleted: (id: string) => void;
  saving: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Reset confirm state when dialog closes
  React.useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  if (!lead) return null;

  const isNew = lead.status === "new";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
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

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">
              Details
            </TabsTrigger>
            <TabsTrigger value="conversation" className="flex-1">
              Conversation
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

            {/* Status & quality controls */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Status
                </label>
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
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Quality
                </label>
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

  const [deleteTarget, setDeleteTarget] = React.useState<Lead | null>(null);

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

  // ─── Open detail dialog (fetch full lead w/ session) ───────────
  async function openDetail(lead: Lead) {
    setSelectedLead({
      ...lead,
      session: null,
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

  // ─── Save (PATCH) ──────────────────────────────────────────────
  async function updateLead(
    id: string,
    patch: { status?: LeadStatus; quality?: LeadQuality }
  ): Promise<boolean> {
    setSaving(true);
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
      if (selectedLead?.id === id) {
        setSelectedLead((prev) =>
          prev ? { ...prev, ...updated, session: prev.session } : prev
        );
      }
      toast.success("Lead updated");
      fetchStats();
      return true;
    } catch (e: any) {
      toast.error(e.message || "Update failed");
      return false;
    } finally {
      setSaving(false);
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
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
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

      {/* List / table */}
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

      {/* Detail dialog */}
      <LeadDetailDialog
        lead={selectedLead}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSave={updateLead}
        onDeleted={handleDelete}
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
