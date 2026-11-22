"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  Copy,
  ExternalLink,
  Settings,
  Send,
  MessageCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Save,
  Pencil,
  Info,
  ShieldCheck,
  Clock,
  KeyRound,
  Webhook,
  Phone,
  AlertCircle,
  Check,
  FileText,
  Power,
  MessageSquareText,
  CalendarClock,
  Receipt,
  LifeBuoy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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

// ─── Types ────────────────────────────────────────────────────────────

interface WhatsAppUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type TemplateType =
  | "new_lead_followup"
  | "missed_chat"
  | "quotation_followup"
  | "payment_reminder"
  | "appointment_confirmation"
  | "booking_reminder"
  | "ticket_update"
  | "custom";

type Provider = "manual" | "meta_cloud_api" | "twilio" | "termii" | "other";

type FollowupContext =
  | "new_lead"
  | "missed_chat"
  | "quotation"
  | "payment"
  | "appointment"
  | "ticket";

interface Template {
  id: string;
  name: string;
  type: TemplateType;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Integration {
  id: string;
  provider: Provider;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  hasApiKey: boolean;
  apiKeyMasked?: string | null;
  webhookUrl: string | null;
  status: "active" | "inactive" | "testing";
  lastTestedAt: string | null;
  notes: string | null;
}

// ─── Config: template type colors ─────────────────────────────────────

const TEMPLATE_TYPE_CONFIG: Record<
  TemplateType,
  { label: string; short: string; badgeClass: string; dotClass: string }
> = {
  new_lead_followup: {
    label: "New Lead Follow-up",
    short: "New Lead",
    badgeClass:
      "bg-primary/10 text-primary border-primary/20 dark:text-primary",
    dotClass: "bg-primary",
  },
  missed_chat: {
    label: "Missed Chat",
    short: "Missed Chat",
    badgeClass:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-500",
  },
  quotation_followup: {
    label: "Quotation Follow-up",
    short: "Quotation",
    badgeClass:
      "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/20",
    dotClass: "bg-violet-500",
  },
  payment_reminder: {
    label: "Payment Reminder",
    short: "Payment",
    badgeClass:
      "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-500",
  },
  appointment_confirmation: {
    label: "Appointment Confirmation",
    short: "Appointment",
    badgeClass:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    dotClass: "bg-emerald-500",
  },
  booking_reminder: {
    label: "Booking Reminder",
    short: "Booking",
    badgeClass:
      "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/20",
    dotClass: "bg-sky-500",
  },
  ticket_update: {
    label: "Ticket Update",
    short: "Ticket Update",
    badgeClass:
      "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
    dotClass: "bg-cyan-500",
  },
  custom: {
    label: "Custom",
    short: "Custom",
    badgeClass: "bg-muted text-muted-foreground border-border",
    dotClass: "bg-muted-foreground",
  },
};

const TEMPLATE_TYPES: TemplateType[] = [
  "new_lead_followup",
  "missed_chat",
  "quotation_followup",
  "payment_reminder",
  "appointment_confirmation",
  "booking_reminder",
  "ticket_update",
  "custom",
];

// ─── Config: follow-up contexts ───────────────────────────────────────

const CONTEXT_OPTIONS: {
  value: FollowupContext;
  label: string;
  hint: string;
}[] = [
  { value: "new_lead", label: "New Lead", hint: "Follow up with a fresh lead" },
  { value: "missed_chat", label: "Missed Chat", hint: "Re-engage after a missed chat" },
  { value: "quotation", label: "Quotation", hint: "Nudge after sending a proposal" },
  { value: "payment", label: "Payment Reminder", hint: "Polite invoice reminder" },
  { value: "appointment", label: "Appointment", hint: "Confirm a scheduled meeting" },
  { value: "ticket", label: "Ticket Update", hint: "Update on a support ticket" },
];

// ─── Config: providers ────────────────────────────────────────────────

const PROVIDER_OPTIONS: { value: Provider; label: string; needsApi: boolean }[] = [
  { value: "manual", label: "Manual Link", needsApi: false },
  { value: "meta_cloud_api", label: "Meta Cloud API", needsApi: true },
  { value: "twilio", label: "Twilio", needsApi: true },
  { value: "termii", label: "Termii", needsApi: true },
  { value: "other", label: "Other", needsApi: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

/** Normalize a phone number for wa.me — digits only, no leading + */
function normalizePhoneForWa(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Build a wa.me click-to-chat URL with an optional pre-filled message */
function buildWaLink(phone: string | null, message: string): string {
  const base = phone ? `https://wa.me/${phone}` : "https://wa.me/1XXXXXXXXXXX";
  return `${base}?text=${encodeURIComponent(message)}`;
}

// ─── Section 1: AI Follow-up Generator ────────────────────────────────

function FollowupGenerator({ user }: { user: WhatsAppUser }) {
  const [context, setContext] = useState<FollowupContext>("new_lead");
  const [recipientName, setRecipientName] = useState("");
  const [service, setService] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [draft, setDraft] = useState("");
  const [tokens, setTokens] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setGenerating(true);
    setDraft("");
    setTokens(null);
    setNote("");
    try {
      const res = await fetch("/api/whatsapp/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context,
          recipientName: recipientName.trim() || undefined,
          service: service.trim() || undefined,
          company: user.businessName,
          customNote: customNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate draft");
      setDraft(data.draft || "");
      setTokens(typeof data.tokens === "number" ? data.tokens : null);
      setNote(data.note || "Review and edit before sending — AI drafts are not auto-sent.");
      toast.success("Draft generated", {
        description: "Review and edit before sending.",
      });
    } catch (e: any) {
      toast.error("Could not generate draft", {
        description: e?.message || "Please try again.",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      toast.success("Draft copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function openWhatsApp() {
    const phone = normalizePhoneForWa(recipientPhone);
    const url = buildWaLink(phone, draft);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const hasDraft = draft.trim().length > 0;

  return (
    <Card className="overflow-hidden border-primary/30">
      <CardHeader className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">AI Follow-up Draft Generator</CardTitle>
              <CardDescription>
                Generate a polished WhatsApp message draft from your context. Review, edit, and send manually — never auto-sent.
              </CardDescription>
            </div>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/20 hidden sm:inline-flex">
            <Sparkles className="size-3" />
            AI
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {/* Context + Recipient row */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-context" className="text-xs font-medium">
              Context <span className="text-destructive">*</span>
            </Label>
            <Select value={context} onValueChange={(v) => setContext(v as FollowupContext)}>
              <SelectTrigger id="wa-context">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTEXT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-recipient" className="text-xs font-medium">
              Recipient name <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="wa-recipient"
              placeholder="e.g. Ada Okafor"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
            />
          </div>
        </div>

        {/* Service + Phone row */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-service" className="text-xs font-medium">
              Service <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="wa-service"
              placeholder="e.g. Enterprise chatbot plan"
              value={service}
              onChange={(e) => setService(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone" className="text-xs font-medium">
              Recipient phone <span className="text-muted-foreground">(for click-to-chat)</span>
            </Label>
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="wa-phone"
                placeholder="e.g. +234 803 000 0000"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className="pl-9"
                inputMode="tel"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Used to pre-fill the wa.me link. Leave blank for a placeholder.
            </p>
          </div>
        </div>

        {/* Custom note */}
        <div className="space-y-1.5">
          <Label htmlFor="wa-note" className="text-xs font-medium">
            Custom note <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="wa-note"
            placeholder='e.g. "Client asked about enterprise pricing and a 2-year contract."'
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">{customNote.length}/500</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={generate}
            disabled={generating}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Generate Draft
              </>
            )}
          </Button>
          {hasDraft && (
            <Button variant="outline" onClick={generate} disabled={generating}>
              <RefreshCw className="size-4" />
              Regenerate
            </Button>
          )}
          {tokens !== null && (
            <span className="ml-auto text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono">
                <Zap /> {tokens} tokens
              </span>
            </span>
          )}
        </div>

        {/* Result */}
        {hasDraft && (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.025] p-4 animate-fade-up">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-draft" className="text-xs font-medium">
                AI draft — edit before sending
              </Label>
              <Badge variant="outline" className="bg-background text-xs font-normal">
                <MessageCircle className="size-3 text-[#25D366]" />
                WhatsApp
              </Badge>
            </div>
            <Textarea
              id="wa-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              className="bg-background resize-y"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={copyDraft}
                className="gap-1.5"
              >
                {copied ? (
                  <>
                    <Check className="size-3.5 text-emerald-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={openWhatsApp}
                className="gap-1.5 bg-[#25D366] text-white hover:bg-[#1da851] hover:text-white"
              >
                <ExternalLink className="size-3.5" />
                Open WhatsApp
              </Button>
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Info className="size-3" />
                {note || "Review and edit before sending — AI drafts are not auto-sent."}
              </span>
            </div>
            {!normalizePhoneForWa(recipientPhone) && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                No valid recipient phone provided — opening a placeholder wa.me link. Enter a real number above to pre-fill the chat.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Small inline Zap icon for token count (avoids another lucide import if unused elsewhere)
function Zap() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
      aria-hidden="true"
    >
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

// ─── Section 2: Message Templates ────────────────────────────────────

function TemplateIcon({ type }: { type: TemplateType }) {
  switch (type) {
    case "new_lead_followup":
      return <MessageCircle className="size-4" />;
    case "missed_chat":
      return <MessageSquareText className="size-4" />;
    case "quotation_followup":
      return <FileText className="size-4" />;
    case "payment_reminder":
      return <Receipt className="size-4" />;
    case "appointment_confirmation":
      return <CalendarClock className="size-4" />;
    case "ticket_update":
      return <LifeBuoy className="size-4" />;
    default:
      return <FileText className="size-4" />;
  }
}

function TemplatesSection({ user }: { user: WhatsAppUser }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/whatsapp/templates", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load templates");
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (e: any) {
      toast.error("Could not load templates", {
        description: e?.message,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setDialogOpen(true);
  }

  async function toggleActive(t: Template, next: boolean) {
    // Optimistic
    setTemplates((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, isActive: next } : x))
    );
    try {
      const res = await fetch(`/api/whatsapp/templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast.success(next ? "Template activated" : "Template deactivated", {
        description: t.name,
      });
    } catch (e: any) {
      // Revert
      setTemplates((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, isActive: !next } : x))
      );
      toast.error("Could not update template", {
        description: e?.message,
      });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/whatsapp/templates/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setTemplates((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      toast.success("Template deleted", {
        description: deleteTarget.name,
      });
      setDeleteTarget(null);
      setDialogOpen(false);
    } catch (e: any) {
      toast.error("Could not delete template", {
        description: e?.message,
      });
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = templates.filter((t) => t.isActive).length;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/30 text-accent-foreground ring-1 ring-accent/40">
              <MessageCircle className="size-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">Message Templates</CardTitle>
              <CardDescription>
                Reusable message bodies with{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{name}`}</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{service}`}</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{company}`}</code>{" "}
                placeholders.
              </CardDescription>
            </div>
          </div>
          <Button onClick={openNew} size="sm" className="gap-1.5">
            <Plus className="size-4" />
            New Template
          </Button>
        </div>
        {templates.length > 0 && (
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-normal">
              {templates.length} total
            </Badge>
            <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-400">
              <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />
              {activeCount} active
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={load}
              disabled={refreshing}
              className="ml-auto h-7 gap-1.5 px-2 text-xs"
            >
              <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <MessageCircle className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No templates yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first WhatsApp message template to reuse in follow-ups.
              </p>
            </div>
            <Button onClick={openNew} size="sm" className="gap-1.5">
              <Plus className="size-4" />
              Create template
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {templates.map((t) => {
              const cfg = TEMPLATE_TYPE_CONFIG[t.type] ?? TEMPLATE_TYPE_CONFIG.custom;
              return (
                <div
                  key={t.id}
                  className={cn(
                    "group relative rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/30",
                    !t.isActive && "opacity-70"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-md ring-1",
                            cfg.badgeClass
                          )}
                        >
                          <TemplateIcon type={t.type} />
                        </span>
                        <p className="truncate font-medium leading-tight">{t.name}</p>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                        {t.content}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-medium uppercase tracking-wide", cfg.badgeClass)}
                      >
                        <span className={cn("size-1.5 rounded-full", cfg.dotClass)} />
                        {cfg.short}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={t.isActive}
                          onCheckedChange={(v) => toggleActive(t, v)}
                          aria-label={t.isActive ? "Deactivate template" : "Activate template"}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(t)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          aria-label="Edit template"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Edit / New dialog */}
      <TemplateDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        template={editing}
        user={user}
        onSaved={(t, isNew) => {
          if (isNew) {
            setTemplates((prev) => [t, ...prev]);
          } else {
            setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
          }
          setDialogOpen(false);
          setEditing(null);
        }}
        onRequestDelete={(t) => setDeleteTarget(t)}
      />

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  template: Template | null;
  user: WhatsAppUser;
  onSaved: (t: Template, isNew: boolean) => void;
  onRequestDelete: (t: Template) => void;
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
  onSaved,
  onRequestDelete,
}: TemplateDialogProps) {
  const isEditing = !!template;
  const [name, setName] = useState("");
  const [type, setType] = useState<TemplateType>("new_lead_followup");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Hydrate when opened
  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setType(template.type);
      setContent(template.content);
      setIsActive(template.isActive);
    } else {
      setName("");
      setType("new_lead_followup");
      setContent("");
      setIsActive(true);
    }
  }, [open, template]);

  async function save() {
    if (name.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    if (content.trim().length === 0) {
      toast.error("Content cannot be empty");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (isEditing && template) {
        res = await fetch(`/api/whatsapp/templates/${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            content,
            isActive,
          }),
        });
      } else {
        res = await fetch("/api/whatsapp/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            type,
            content,
            isActive,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const saved: Template = data.template;
      toast.success(isEditing ? "Template updated" : "Template created", {
        description: saved.name,
      });
      onSaved(saved, !isEditing);
    } catch (e: any) {
      toast.error("Could not save template", {
        description: e?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-4 text-primary" />
            {isEditing ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            Use{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{name}`}</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{service}`}</code>, and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{company}`}</code>{" "}
            placeholders — they will be replaced when the template is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name" className="text-xs font-medium">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tpl-name"
                placeholder="e.g. New lead warm intro"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-type" className="text-xs font-medium">
                Type {isEditing && <span className="text-muted-foreground">(locked)</span>}
              </Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as TemplateType)}
                disabled={isEditing}
              >
                <SelectTrigger id="tpl-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((t) => {
                    const cfg = TEMPLATE_TYPE_CONFIG[t];
                    return (
                      <SelectItem key={t} value={t}>
                        <span className="flex items-center gap-2">
                          <span className={cn("size-1.5 rounded-full", cfg.dotClass)} />
                          {cfg.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-content" className="text-xs font-medium">
              Content <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="tpl-content"
              placeholder={`Hi {name}, thanks for reaching out about {service} — this is {company}. Are you available for a quick call this week?`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              maxLength={2000}
              className="resize-y"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{type === "booking_reminder" ? `{name} {service} {company} {time} {link}` : `{name} {service} {company}`}</span>
              <span>{content.length}/2000</span>
            </div>
          </div>

          {type === "booking_reminder" && (
            <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              Sent automatically 24 hours and 1 hour before a booking, when the visitor gave a phone number and WhatsApp is connected through Meta or Twilio.{" "}
              <code className="rounded bg-muted px-1">{`{time}`}</code> is the booking time and{" "}
              <code className="rounded bg-muted px-1">{`{link}`}</code> lets them reschedule or cancel. Meta only delivers free-form messages to people who messaged you in the last 24 hours, so some reminders may not arrive; the email reminder always goes.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="tpl-active" className="text-sm font-medium">
                Active
              </Label>
              <p className="text-xs text-muted-foreground">
                Inactive templates are retained but excluded from the active list.
              </p>
            </div>
            <Switch
              id="tpl-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {isEditing && template ? (
            <Button
              variant="outline"
              onClick={() => onRequestDelete(template)}
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : null}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  {isEditing ? "Save changes" : "Create template"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section 3: Integration Settings ─────────────────────────────────

function IntegrationSection() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    provider: "manual" as Provider,
    phoneNumber: "",
    phoneNumberId: "",
    apiKey: "", // empty = leave as-is
    webhookUrl: "",
    notes: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/integration", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load integration");
      const i: Integration = data.integration;
      setIntegration(i);
      setForm({
        provider: i.provider,
        phoneNumber: i.phoneNumber || "",
        phoneNumberId: i.phoneNumberId || "",
        apiKey: "",
        webhookUrl: i.webhookUrl || "",
        notes: i.notes || "",
      });
    } catch (e: any) {
      toast.error("Could not load integration", {
        description: e?.message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider: form.provider,
        phoneNumber: form.phoneNumber.trim() || null,
        phoneNumberId: form.phoneNumberId.trim() || null,
        webhookUrl: form.webhookUrl.trim() || null,
        notes: form.notes.trim() || null,
      };
      // Only send apiKey if the user typed a new one
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();

      const res = await fetch("/api/whatsapp/integration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const updated: Integration = data.integration;
      setIntegration((prev) => ({
        ...updated,
        apiKeyMasked: prev?.apiKeyMasked ?? null,
        lastTestedAt: prev?.lastTestedAt ?? null,
      }));
      setForm((f) => ({ ...f, apiKey: "" }));
      toast.success("Integration settings saved");
    } catch (e: any) {
      toast.error("Could not save integration", {
        description: e?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  const providerCfg = PROVIDER_OPTIONS.find((p) => p.value === form.provider);
  const needsApi = providerCfg?.needsApi ?? false;
  const isMeta = form.provider === "meta_cloud_api";
  const isManual = form.provider === "manual";
  const isActive = integration?.status === "active";

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground ring-1 ring-border">
              <Settings className="size-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                WhatsApp Integration
                {integration && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-medium uppercase tracking-wide",
                      isActive
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    <span
                      className={cn(
                        "mr-1 inline-block size-1.5 rounded-full",
                        isActive ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
                      )}
                    />
                    {integration.status}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Configure how WhatsApp follow-ups are delivered.
              </CardDescription>
            </div>
          </div>
        </div>
        {integration?.lastTestedAt && (
          <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            Last tested {formatRelativeTime(integration.lastTestedAt)}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            {/* Provider setup banners */}
            {isMeta && (
              <Alert className="border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300">
                <Info className="size-4 text-emerald-600" />
                <AlertTitle className="text-sm font-medium">Meta Cloud API</AlertTitle>
                <AlertDescription className="text-xs">
                  When your access token and phone number ID are saved, outbound messages from{" "}
                  <code className="rounded bg-muted px-1 py-0.5">/api/whatsapp/send</code> are delivered
                  via the WhatsApp Business API. Drafts in this view still use click-to-chat for manual review.
                </AlertDescription>
              </Alert>
            )}
            {!isManual && !isMeta && (
              <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300">
                <Info className="size-4 text-amber-600" />
                <AlertTitle className="text-sm font-medium">Provider setup required</AlertTitle>
                <AlertDescription className="text-xs">
                  Live send for {form.provider} is not yet supported. Use Manual Link or Meta Cloud API for outbound delivery.
                </AlertDescription>
              </Alert>
            )}

            {/* Manual link info */}
            {isManual && (
              <Alert className="border-primary/30 bg-primary/5">
                <MessageCircle className="size-4 text-primary" />
                <AlertTitle className="text-sm font-medium">Manual Link mode</AlertTitle>
                <AlertDescription className="text-xs">
                  Click-to-chat <code className="rounded bg-muted px-1 py-0.5">wa.me</code> links are generated from drafts — no API key required. Recipients open WhatsApp with your message pre-filled.
                </AlertDescription>
              </Alert>
            )}

            {/* Provider */}
            <div className="space-y-1.5">
              <Label htmlFor="int-provider" className="text-xs font-medium">
                Provider
              </Label>
              <Select
                value={form.provider}
                onValueChange={(v) => setForm({ ...form, provider: v as Provider })}
              >
                <SelectTrigger id="int-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Phone Number */}
            <div className="space-y-1.5">
              <Label htmlFor="int-phone" className="text-xs font-medium">
                Phone number <span className="text-muted-foreground">(WhatsApp business)</span>
              </Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="int-phone"
                  placeholder="e.g. +234 803 000 0000"
                  value={form.phoneNumber}
                  onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                  className="pl-9"
                  inputMode="tel"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The WhatsApp number your business uses to send and receive messages.
              </p>
            </div>

            {/* Phone Number ID (Meta only) */}
            {isMeta && (
              <div className="space-y-1.5 animate-fade-up">
                <Label htmlFor="int-phone-id" className="text-xs font-medium">
                  Phone Number ID <span className="text-muted-foreground">(Meta Cloud API)</span>
                </Label>
                <Input
                  id="int-phone-id"
                  placeholder="e.g. 1029384756"
                  value={form.phoneNumberId}
                  onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Found in the Meta for Developers console under WhatsApp → Phone Numbers.
                </p>
              </div>
            )}

            {/* API Key */}
            {needsApi && (
              <div className="space-y-1.5 animate-fade-up">
                <Label htmlFor="int-apikey" className="text-xs font-medium flex items-center gap-1.5">
                  <KeyRound className="size-3.5" />
                  API key
                </Label>
                <Input
                  id="int-apikey"
                  type="password"
                  placeholder={
                    integration?.hasApiKey
                      ? "•••••••• (enter new key to replace)"
                      : "Paste your API key"
                  }
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  autoComplete="off"
                />
                {integration?.hasApiKey && integration.apiKeyMasked && (
                  <p className="text-xs text-muted-foreground">
                    Current key:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                      {integration.apiKeyMasked}
                    </code>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Stored securely and never exposed. Enter a new key to replace.
                </p>
              </div>
            )}

            {/* Webhook URL */}
            {needsApi && (
              <div className="space-y-1.5 animate-fade-up">
                <Label htmlFor="int-webhook" className="text-xs font-medium flex items-center gap-1.5">
                  <Webhook className="size-3.5" />
                  Webhook URL
                </Label>
                <Input
                  id="int-webhook"
                  placeholder="https://your-app.com/api/whatsapp/incoming"
                  value={form.webhookUrl}
                  onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  For receiving inbound messages and delivery receipts.
                </p>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="int-notes" className="text-xs font-medium">
                Notes <span className="text-muted-foreground">(internal)</span>
              </Label>
              <Textarea
                id="int-notes"
                placeholder="e.g. Provisioned by IT on 2025-01-15. Renew token quarterly."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                maxLength={2000}
                className="resize-y"
              />
            </div>

            <Separator />

            {/* Save */}
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={load}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className="size-3.5" />
                Reset
              </Button>
              <Button onClick={save} disabled={saving} className="gap-1.5">
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="size-4" />
                    Save Settings
                  </>
                )}
              </Button>
            </div>

            {/* Security note */}
            <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
              <div className="flex gap-2">
                <ShieldCheck className="size-4 shrink-0 text-primary mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-foreground">Security note</p>
                  <p className="text-xs text-muted-foreground">
                    API keys are stored server-side only and are never exposed to the frontend. The masked preview shows only the first and last 4 characters.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page header ──────────────────────────────────────────────────────

function PageHeader({ user }: { user: WhatsAppUser }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#25D366]/15 text-[#25D366] ring-1 ring-[#25D366]/25">
            <MessageCircle className="size-5" />
          </span>
          WhatsApp Automation
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage message templates, generate AI follow-up drafts, and configure your WhatsApp integration for{" "}
          <span className="font-medium text-foreground">{user.businessName}</span>.
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1 font-normal">
          <Send className="size-3" />
          Manual review required
        </Badge>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────

export function WhatsAppView({ user }: { user: WhatsAppUser }) {
  return (
    <div className="space-y-6">
      <PageHeader user={user} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: AI generator + templates */}
        <div className="space-y-6 lg:col-span-2">
          <FollowupGenerator user={user} />
          <TemplatesSection user={user} />
        </div>

        {/* Right column: integration settings */}
        <div className="lg:col-span-1">
          <IntegrationSection />
        </div>
      </div>

      {/* Footer notice */}
      <div className="rounded-lg border border-dashed bg-muted/30 p-4">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="size-4 shrink-0 text-muted-foreground mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-medium">No auto-sending</p>
            <p className="text-xs text-muted-foreground">
              All AI-generated drafts and templates are designed for manual review. Messages are never sent automatically — operators must explicitly open WhatsApp and press send. This keeps your business compliant and prevents unintended outreach.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
