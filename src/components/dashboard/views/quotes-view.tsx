"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileDown,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  StickyNote,
  Tag,
  Trash2,
  User,
  Wand2,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { pdf } from "@react-pdf/renderer";
import { ProposalPDF } from "@/components/dashboard/views/proposal-pdf";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────

interface User {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface GeneratedDocument {
  id: string;
  title: string;
  content: string;
  type: string;
  createdAt: string;
  quoteRequestId?: string;
}

interface TokenInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ProposalItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  sortOrder: number;
}

interface Followup {
  id: string;
  type: "email" | "whatsapp" | "call" | "note";
  content: string;
  scheduledFor: string | null;
  completedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface ProposalTemplate {
  id: string;
  name: string;
  type: string;
  industry: string | null;
  description: string | null;
  sections: string[];
  defaultItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  isGlobal: boolean;
  isActive: boolean;
}

interface QuoteListItem {
  id: string;
  clientName: string;
  companyName: string | null;
  service: string;
  requirements: string;
  budgetRange: string | null;
  timeline: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  // Pricing (added by backend)
  subtotal?: number;
  discount?: number;
  discountType?: string;
  taxRate?: number;
  taxAmount?: number;
  total?: number;
  currency?: string;
  acceptedAt?: string | null;
  latestDocument: GeneratedDocument | null;
}

interface ActiveQuoteDetail {
  id: string;
  clientName: string;
  companyName: string | null;
  service: string;
  requirements: string;
  budgetRange: string | null;
  timeline: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  // Pricing
  subtotal: number;
  discount: number;
  discountType: "percentage" | "flat";
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  // Acceptance
  acceptedAt: string | null;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
  clientFeedback: string | null;
  // Template
  templateId: string | null;
  // Relations
  documents: GeneratedDocument[];
  items: ProposalItem[];
  followups: Followup[];
}

interface EmailDraft {
  subject: string;
  body: string;
  tokens?: number;
}

// ─── Static options ───────────────────────────────────────────────────────

const SERVICES = [
  "AI Chatbot Implementation",
  "Website Development",
  "Cloud Migration",
  "Cybersecurity Audit",
  "DevOps Automation",
  "Mobile App Development",
  "SEO & Digital Marketing",
  "AI Automation Workflow",
  "Data Analytics Dashboard",
  "Other",
];

const BUDGET_RANGES = [
  "Less than $1k",
  "$1k – $5k",
  "$5k – $25k",
  "$25k – $100k",
  "$100k+",
  "Not sure",
];

const TIMELINES = [
  "Less than 2 weeks",
  "2 – 4 weeks",
  "1 – 3 months",
  "3 – 6 months",
  "6+ months",
];

// Status flow: Draft → Sent → Viewed → (Accepted | Rejected)
// "generated" is the intermediate AI-generated state.
const STATUS_FLOW: Array<{
  key: string;
  label: string;
  icon: typeof FileText;
}> = [
  { key: "draft", label: "Draft", icon: FileText },
  { key: "generated", label: "Generated", icon: Sparkles },
  { key: "sent", label: "Sent", icon: Send },
  { key: "viewed", label: "Viewed", icon: Clock },
  { key: "accepted", label: "Accepted", icon: CheckCircle2 },
];

const FOLLOWUP_TYPES: Array<{
  value: Followup["type"];
  label: string;
  icon: typeof Mail;
}> = [
  { value: "email", label: "Email", icon: Mail },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "call", label: "Call", icon: Phone },
  { value: "note", label: "Note", icon: StickyNote },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = "USD") {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function timeAgo(dateStr?: string | null) {
  if (!dateStr) return "";
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return "";
  }
}

function computeTotals(
  items: ProposalItem[],
  discount: number,
  discountType: "percentage" | "flat",
  taxRate: number
) {
  const subtotal = items.reduce(
    (sum, i) => sum + (i.quantity || 0) * (i.unitPrice || 0),
    0
  );
  const discountAmount =
    discountType === "percentage"
      ? (subtotal * (discount || 0)) / 100
      : discount || 0;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const taxAmount = (afterDiscount * (taxRate || 0)) / 100;
  const total = afterDiscount + taxAmount;
  return { subtotal, discountAmount, afterDiscount, taxAmount, total };
}

function buildMailto(subject: string, body: string, to?: string | null) {
  const recipient = to && /.+@.+\..+/.test(to) ? to : "";
  const base = recipient ? `mailto:${recipient}` : `mailto:`;
  return `${base}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

// ─── Main component ───────────────────────────────────────────────────────

export function QuotesView({ user }: { user: User }) {
  // Form state
  const [clientName, setClientName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [serviceChoice, setServiceChoice] = useState<string>("");
  const [serviceOther, setServiceOther] = useState("");
  const [requirements, setRequirements] = useState("");
  const [budgetRange, setBudgetRange] = useState<string>("");
  const [timeline, setTimeline] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // History state
  const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Active dialog (view proposal) state
  const [viewOpen, setViewOpen] = useState(false);
  const [activeQuote, setActiveQuote] = useState<ActiveQuoteDetail | null>(
    null
  );
  const [activeDoc, setActiveDoc] = useState<GeneratedDocument | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeTokens, setActiveTokens] = useState<TokenInfo | null>(null);

  // Pricing editor state (local mirror of activeQuote pricing fields so the
  // user can edit before clicking "Save Pricing")
  const [pricingDraft, setPricingDraft] = useState<{
    discount: number;
    discountType: "percentage" | "flat";
    taxRate: number;
  }>({ discount: 0, discountType: "percentage", taxRate: 0 });
  const [addingItem, setAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({
    description: "",
    quantity: 1,
    unitPrice: 0,
  });
  const [savingPricing, setSavingPricing] = useState(false);

  // Acceptance state
  const [acceptance, setAcceptance] = useState({
    acceptedByName: "",
    acceptedByEmail: "",
    clientFeedback: "",
  });
  const [savingAcceptance, setSavingAcceptance] = useState(false);

  // Follow-up state
  const [newFollowup, setNewFollowup] = useState<{
    type: Followup["type"];
    content: string;
    scheduledFor: string;
  }>({ type: "email", content: "", scheduledFor: "" });
  const [savingFollowup, setSavingFollowup] = useState(false);

  // Email draft state
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [activeTab, setActiveTab] = useState("proposal");

  // Regenerate state (track which quote is regenerating)
  const [regenId, setRegenId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<QuoteListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Load history ───────────────────────────────────────────────────

  const loadQuotes = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/quotes");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load proposals");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/proposal-templates");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      // silent fail — templates are optional
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    loadQuotes();
    loadTemplates();
  }, [loadQuotes, loadTemplates]);

  // ─── Submit form ────────────────────────────────────────────────────

  const resolvedService =
    serviceChoice === "Other" ? serviceOther.trim() : serviceChoice;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId]
  );

  function resetForm() {
    setClientName("");
    setCompanyName("");
    setServiceChoice("");
    setServiceOther("");
    setRequirements("");
    setBudgetRange("");
    setTimeline("");
    setNotes("");
    setTemplateId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!clientName.trim()) {
      toast.error("Client name is required");
      return;
    }
    if (!resolvedService) {
      toast.error("Please choose or type the service needed");
      return;
    }
    if (!requirements.trim()) {
      toast.error("Requirements are required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          companyName: companyName.trim() || null,
          service: resolvedService,
          requirements: requirements.trim(),
          budgetRange: budgetRange || null,
          timeline: timeline || null,
          notes: notes.trim() || null,
          templateId: templateId || null,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast.success("Proposal generated");
      setActiveTokens(data.tokens ?? null);
      setActiveTab("proposal");

      // Fetch the full quote detail (items + followups + pricing) so the
      // dialog shows everything correctly.
      await loadActiveQuote(data.quote.id);

      resetForm();
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate proposal");
    } finally {
      setSubmitting(false);
      // Always refresh the list — a draft may have been created even on
      // partial AI failure.
      loadQuotes();
    }
  }

  // ─── Load active quote detail ───────────────────────────────────────

  async function loadActiveQuote(quoteId: string) {
    setActiveLoading(true);
    setViewOpen(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const q = data.quote as ActiveQuoteDetail;
      setActiveQuote(q);
      const latest = q.documents?.[0] || null;
      setActiveDoc(latest);
      setPricingDraft({
        discount: q.discount ?? 0,
        discountType: q.discountType ?? "percentage",
        taxRate: q.taxRate ?? 0,
      });
      setAcceptance({
        acceptedByName: q.acceptedByName || "",
        acceptedByEmail: q.acceptedByEmail || "",
        clientFeedback: q.clientFeedback || "",
      });
      setEmailDraft(null);
      if (!latest) {
        toast.error("No generated proposal found. Try Regenerate.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load proposal");
      setViewOpen(false);
    } finally {
      setActiveLoading(false);
    }
  }

  // ─── Open quote detail from history ─────────────────────────────────

  async function openQuote(quote: QuoteListItem) {
    setActiveTokens(null);
    await loadActiveQuote(quote.id);
  }

  // ─── Regenerate ─────────────────────────────────────────────────────

  async function regenerate(quote: QuoteListItem, e?: React.MouseEvent) {
    e?.stopPropagation();
    setRegenId(quote.id);
    try {
      const res = await fetch("/api/quotes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteRequestId: quote.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast.success("Proposal regenerated");
      setActiveTokens(data.tokens ?? null);
      setActiveTab("proposal");
      await loadActiveQuote(quote.id);
      loadQuotes();
    } catch (err: any) {
      toast.error(err?.message || "Failed to regenerate proposal");
    } finally {
      setRegenId(null);
    }
  }

  // ─── Copy proposal ──────────────────────────────────────────────────

  async function copyProposal(quote: QuoteListItem, e?: React.MouseEvent) {
    e?.stopPropagation();
    setCopyingId(quote.id);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/copy`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Proposal duplicated");
      loadQuotes();
    } catch (err: any) {
      toast.error(err?.message || "Failed to duplicate proposal");
    } finally {
      setCopyingId(null);
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/quotes/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Quote deleted");
      setQuotes((prev) => prev.filter((q) => q.id !== deleteTarget.id));
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete quote");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ─── Pricing actions ────────────────────────────────────────────────

  async function addItem() {
    if (!activeQuote) return;
    if (!newItem.description.trim()) {
      toast.error("Item description is required");
      return;
    }
    try {
      const res = await fetch(`/api/quotes/${activeQuote.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: newItem.description.trim(),
          quantity: Number(newItem.quantity) || 1,
          unitPrice: Number(newItem.unitPrice) || 0,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Refresh items + pricing from server (totals recompute server-side).
      await refreshActiveQuoteItems();
      setNewItem({ description: "", quantity: 1, unitPrice: 0 });
      setAddingItem(false);
      toast.success("Line item added");
    } catch (e: any) {
      toast.error(e?.message || "Failed to add item");
    }
  }

  async function deleteItem(itemId: string) {
    if (!activeQuote) return;
    try {
      const res = await fetch(
        `/api/quotes/${activeQuote.id}/items?itemId=${encodeURIComponent(
          itemId
        )}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await refreshActiveQuoteItems();
      toast.success("Line item removed");
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove item");
    }
  }

  async function refreshActiveQuoteItems() {
    if (!activeQuote) return;
    try {
      const [itemsRes, quoteRes] = await Promise.all([
        fetch(`/api/quotes/${activeQuote.id}/items`).then((r) => r.json()),
        fetch(`/api/quotes/${activeQuote.id}`).then((r) => r.json()),
      ]);
      if (itemsRes.items) {
        setActiveQuote((prev) =>
          prev
            ? {
                ...prev,
                items: itemsRes.items,
                subtotal: quoteRes.quote?.subtotal ?? prev.subtotal,
                taxAmount: quoteRes.quote?.taxAmount ?? prev.taxAmount,
                total: quoteRes.quote?.total ?? prev.total,
                discount: quoteRes.quote?.discount ?? prev.discount,
                discountType: quoteRes.quote?.discountType ?? prev.discountType,
                taxRate: quoteRes.quote?.taxRate ?? prev.taxRate,
              }
            : prev
        );
        setPricingDraft({
          discount: quoteRes.quote?.discount ?? 0,
          discountType: quoteRes.quote?.discountType ?? "percentage",
          taxRate: quoteRes.quote?.taxRate ?? 0,
        });
      }
    } catch {
      // silent — the next openQuote will resync
    }
  }

  async function savePricing() {
    if (!activeQuote) return;
    setSavingPricing(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount: Number(pricingDraft.discount) || 0,
          discountType: pricingDraft.discountType,
          taxRate: Number(pricingDraft.taxRate) || 0,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Reload full detail to reflect recomputed totals.
      await loadActiveQuote(activeQuote.id);
      loadQuotes();
      toast.success("Pricing saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save pricing");
    } finally {
      setSavingPricing(false);
    }
  }

  // ─── Status change ──────────────────────────────────────────────────

  async function changeStatus(status: string) {
    if (!activeQuote) return;
    try {
      const res = await fetch(`/api/quotes/${activeQuote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setActiveQuote((prev) =>
        prev ? { ...prev, status: data.quote?.status ?? status } : prev
      );
      setQuotes((prev) =>
        prev.map((q) =>
          q.id === activeQuote.id ? { ...q, status } : q
        )
      );
      toast.success(`Status: ${status}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to change status");
    }
  }

  // ─── Acceptance ─────────────────────────────────────────────────────

  async function recordAcceptance(status: "accepted" | "rejected") {
    if (!activeQuote) return;
    setSavingAcceptance(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuote.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          acceptedByName: acceptance.acceptedByName.trim() || undefined,
          acceptedByEmail: acceptance.acceptedByEmail.trim() || undefined,
          clientFeedback: acceptance.clientFeedback.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(
        status === "accepted" ? "Proposal accepted 🎉" : "Proposal rejected"
      );
      await loadActiveQuote(activeQuote.id);
      loadQuotes();
    } catch (e: any) {
      toast.error(e?.message || "Failed to record acceptance");
    } finally {
      setSavingAcceptance(false);
    }
  }

  // ─── Follow-ups ─────────────────────────────────────────────────────

  async function addFollowup() {
    if (!activeQuote) return;
    if (!newFollowup.content.trim()) {
      toast.error("Follow-up content is required");
      return;
    }
    setSavingFollowup(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuote.id}/followups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newFollowup.type,
          content: newFollowup.content.trim(),
          scheduledFor: newFollowup.scheduledFor
            ? new Date(newFollowup.scheduledFor).toISOString()
            : null,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const created = data.followup as Followup;
      setActiveQuote((prev) =>
        prev
          ? { ...prev, followups: [created, ...(prev.followups || [])] }
          : prev
      );
      setNewFollowup({ type: "email", content: "", scheduledFor: "" });
      toast.success("Follow-up logged");
    } catch (e: any) {
      toast.error(e?.message || "Failed to add follow-up");
    } finally {
      setSavingFollowup(false);
    }
  }

  // ─── AI Email draft ─────────────────────────────────────────────────

  async function generateEmailDraft() {
    if (!activeQuote) return;
    setGeneratingEmail(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuote.id}/email-draft`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmailDraft({
        subject: data.subject || `Proposal for ${activeQuote.service}`,
        body: data.body || "",
        tokens: typeof data.tokens === "number" ? data.tokens : undefined,
      });
      toast.success("Email draft generated");
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate email draft");
    } finally {
      setGeneratingEmail(false);
    }
  }

  // ─── Copy & Download ────────────────────────────────────────────────

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Proposal copied to clipboard");
    } catch {
      toast.error("Failed to copy. Try selecting manually.");
    }
  }

  function downloadMarkdown(doc: GeneratedDocument) {
    const blob = new Blob([doc.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName =
      (doc.title || "proposal").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Downloaded markdown file");
  }

  async function downloadPDF(doc: GeneratedDocument) {
    const toastId = "pdf-download";
    try {
      toast.loading("Generating PDF…", { id: toastId });
      const client = activeQuote?.clientName || "Client";
      const dateStr = activeQuote?.createdAt
        ? format(new Date(activeQuote.createdAt), "dd MMM yyyy")
        : format(new Date(), "dd MMM yyyy");
      const element = (
        <ProposalPDF
          title={doc.title}
          clientName={client}
          businessName={user.businessName}
          date={dateStr}
          content={doc.content}
        />
      );
      const blob = await pdf(element).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName =
        (doc.title || "proposal").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `${safeName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded successfully", { id: toastId });
    } catch (e: any) {
      toast.error("PDF generation failed: " + (e?.message || ""), { id: toastId });
    }
  }

  // ─── Derived pricing preview (frontend live recompute) ──────────────

  const pricingPreview = useMemo(() => {
    if (!activeQuote) {
      return computeTotals([], 0, "percentage", 0);
    }
    return computeTotals(
      activeQuote.items,
      Number(pricingDraft.discount) || 0,
      pricingDraft.discountType,
      Number(pricingDraft.taxRate) || 0
    );
  }, [activeQuote, pricingDraft]);

  const currency = activeQuote?.currency || "USD";

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Quotes & Proposals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Turn a short brief into a polished, client-ready proposal in seconds.
          </p>
        </div>
        <Badge className="bg-accent/20 text-accent-foreground border-transparent">
          <Sparkles className="h-3 w-3 mr-1" />
          AI-powered
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 lg:gap-6">
        {/* LEFT — New Proposal form */}
        <Card className="self-start lg:sticky lg:top-[4.5rem] shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wand2 className="h-5 w-5 text-primary" />
              New Proposal
            </CardTitle>
            <CardDescription>
              Fill in the brief — the AI drafts a structured proposal instantly.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {/* Template */}
              <div className="space-y-1.5">
                <Label>Proposal template</Label>
                <Select
                  value={templateId || "none"}
                  onValueChange={(v) => setTemplateId(v === "none" ? "" : v)}
                  disabled={submitting || loadingTemplates}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        loadingTemplates
                          ? "Loading templates…"
                          : "Default (no template)"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">(No template)</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          {t.name}
                          {t.isGlobal && (
                            <Badge
                              variant="outline"
                              className="ml-1 text-[10px] py-0 px-1.5 h-4"
                            >
                              global
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 text-xs space-y-1.5">
                    {selectedTemplate.description && (
                      <p className="text-muted-foreground">
                        {selectedTemplate.description}
                      </p>
                    )}
                    {selectedTemplate.defaultItems?.length > 0 && (
                      <div className="space-y-0.5">
                        <p className="font-medium text-foreground">
                          Default line items:
                        </p>
                        {selectedTemplate.defaultItems
                          .slice(0, 4)
                          .map((it, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="truncate">{it.description}</span>
                              <span className="text-muted-foreground whitespace-nowrap">
                                {it.quantity} × {formatCurrency(it.unitPrice)}
                              </span>
                            </div>
                          ))}
                        {selectedTemplate.defaultItems.length > 4 && (
                          <p className="text-[11px] text-muted-foreground">
                            +{selectedTemplate.defaultItems.length - 4} more…
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Client name */}
              <div className="space-y-1.5">
                <Label htmlFor="clientName">
                  Client name <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Ada Okonkwo"
                    className="pl-8"
                    disabled={submitting}
                    maxLength={120}
                  />
                </div>
              </div>

              {/* Company name */}
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company name</Label>
                <div className="relative">
                  <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Optional"
                    className="pl-8"
                    disabled={submitting}
                    maxLength={120}
                  />
                </div>
              </div>

              {/* Service needed */}
              <div className="space-y-1.5">
                <Label htmlFor="service">
                  Service needed <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={serviceChoice}
                  onValueChange={setServiceChoice}
                  disabled={submitting}
                >
                  <SelectTrigger id="service" className="w-full">
                    <SelectValue placeholder="Choose a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {serviceChoice === "Other" && (
                  <Input
                    value={serviceOther}
                    onChange={(e) => setServiceOther(e.target.value)}
                    placeholder="Type the service needed"
                    disabled={submitting}
                    maxLength={200}
                    className="mt-2"
                  />
                )}
              </div>

              {/* Requirements */}
              <div className="space-y-1.5">
                <Label htmlFor="requirements">
                  Requirements <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="requirements"
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="Describe what the client needs, goals, scope, integrations…"
                  rows={4}
                  disabled={submitting}
                  maxLength={4000}
                />
                <p className="text-[11px] text-muted-foreground">
                  {requirements.length}/4000
                </p>
              </div>

              {/* Budget range */}
              <div className="space-y-1.5">
                <Label>Budget range</Label>
                <Select
                  value={budgetRange}
                  onValueChange={setBudgetRange}
                  disabled={submitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select budget" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUDGET_RANGES.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Timeline */}
              <div className="space-y-1.5">
                <Label>Timeline</Label>
                <Select
                  value={timeline}
                  onValueChange={setTimeline}
                  disabled={submitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select timeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMELINES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything else we should know — preferences, constraints, contacts…"
                  rows={3}
                  disabled={submitting}
                  maxLength={4000}
                />
              </div>
            </CardContent>

            <CardFooter className="flex-col items-stretch gap-2">
              <Button
                type="submit"
                disabled={submitting}
                className="w-full brand-gradient text-white hover:opacity-95"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    AI is drafting your proposal…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Proposal
                  </>
                )}
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                Generates a markdown proposal with 7 standard sections.
              </p>
            </CardFooter>
          </form>
        </Card>

        {/* RIGHT — History list */}
        <div className="space-y-3 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Generated Proposals
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadQuotes}
              disabled={loadingList}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loadingList && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {loadingList ? (
            <HistorySkeleton />
          ) : quotes.length === 0 ? (
            <EmptyHistory />
          ) : (
            <div className="max-h-[75vh] overflow-y-auto scroll-thin pr-1 space-y-3">
              {quotes.map((q) => (
                <QuoteCard
                  key={q.id}
                  quote={q}
                  onOpen={() => openQuote(q)}
                  onRegenerate={(e) => regenerate(q, e)}
                  onCopy={(e) => copyProposal(q, e)}
                  onDelete={() => setDeleteTarget(q)}
                  regenerating={regenId === q.id}
                  copying={copyingId === q.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Proposal Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <span className="truncate">
                {activeDoc?.title || activeQuote?.service || "Proposal"}
              </span>
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {activeQuote?.clientName && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {activeQuote.clientName}
                </span>
              )}
              {activeQuote?.createdAt && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(
                    new Date(activeQuote.createdAt),
                    "dd MMM yyyy, HH:mm"
                  )}
                </span>
              )}
              {activeTokens && (
                <span className="inline-flex items-center gap-1 text-accent-foreground/80">
                  <Sparkles className="h-3 w-3" />
                  {activeTokens.totalTokens.toLocaleString()} tokens
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {activeQuote && (
            <StatusFlowBar
              status={activeQuote.status}
              acceptedAt={activeQuote.acceptedAt}
              onChange={changeStatus}
            />
          )}

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 min-h-0 flex flex-col"
          >
            <TabsList className="self-start">
              <TabsTrigger value="proposal">
                <FileText className="h-3.5 w-3.5" />
                Proposal
              </TabsTrigger>
              <TabsTrigger value="pricing">
                <Tag className="h-3.5 w-3.5" />
                Pricing
                {activeQuote && activeQuote.items.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 text-[10px]"
                  >
                    {activeQuote.items.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="followups">
                <Clock className="h-3.5 w-3.5" />
                Follow-ups
                {activeQuote && activeQuote.followups.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 text-[10px]"
                  >
                    {activeQuote.followups.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ─── Proposal tab ─── */}
            <TabsContent
              value="proposal"
              className="flex-1 min-h-0 overflow-y-auto scroll-thin pr-1 -mr-1 mt-2"
            >
              {activeLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-5 w-1/4 mt-4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-5 w-1/3 mt-4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : activeDoc ? (
                <div className="prose-danets text-sm leading-relaxed">
                  <ReactMarkdown
                    components={{
                      h1: (props) => (
                        <h1
                          className="text-xl font-bold mt-4 mb-2 text-foreground"
                          {...props}
                        />
                      ),
                      h2: (props) => (
                        <h2
                          className="text-base font-semibold mt-5 mb-2 text-primary border-b border-border/60 pb-1"
                          {...props}
                        />
                      ),
                      h3: (props) => (
                        <h3
                          className="text-sm font-semibold mt-3 mb-1 text-foreground"
                          {...props}
                        />
                      ),
                      h4: (props) => (
                        <h4
                          className="text-sm font-medium mt-2 mb-1 text-foreground"
                          {...props}
                        />
                      ),
                      p: (props) => (
                        <p className="text-sm leading-relaxed my-2" {...props} />
                      ),
                      ul: (props) => (
                        <ul
                          className="list-disc pl-5 my-2 space-y-0.5"
                          {...props}
                        />
                      ),
                      ol: (props) => (
                        <ol
                          className="list-decimal pl-5 my-2 space-y-0.5"
                          {...props}
                        />
                      ),
                      li: (props) => (
                        <li className="text-sm leading-relaxed" {...props} />
                      ),
                      strong: (props) => (
                        <strong
                          className="font-semibold text-foreground"
                          {...props}
                        />
                      ),
                      em: (props) => <em className="italic" {...props} />,
                      code: (props) => (
                        <code
                          className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono"
                          {...props}
                        />
                      ),
                      pre: (props) => (
                        <pre
                          className="bg-muted p-3 rounded-md text-xs overflow-x-auto my-2"
                          {...props}
                        />
                      ),
                      blockquote: (props) => (
                        <blockquote
                          className="border-l-2 border-primary pl-3 italic text-muted-foreground my-2"
                          {...props}
                        />
                      ),
                      hr: () => <hr className="my-3 border-border" />,
                      a: (props) => (
                        <a
                          className="text-primary underline underline-offset-2"
                          target="_blank"
                          rel="noopener noreferrer"
                          {...props}
                        />
                      ),
                    }}
                  >
                    {activeDoc.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No content available.
                </div>
              )}
            </TabsContent>

            {/* ─── Pricing tab ─── */}
            <TabsContent
              value="pricing"
              className="flex-1 min-h-0 overflow-y-auto scroll-thin pr-1 -mr-1 mt-2 space-y-4"
            >
              {activeQuote && (
                <>
                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Tag className="h-4 w-4 text-primary" />
                        Pricing Table
                      </CardTitle>
                      <CardDescription>
                        Add line items, set discount & tax — totals update live.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="w-16 text-right">
                              Qty
                            </TableHead>
                            <TableHead className="w-24 text-right">
                              Unit Price
                            </TableHead>
                            <TableHead className="w-28 text-right">
                              Total
                            </TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeQuote.items.length === 0 && !addingItem && (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-center text-sm text-muted-foreground py-6"
                              >
                                No line items yet. Click “Add item” to start
                                building your quote.
                              </TableCell>
                            </TableRow>
                          )}
                          {activeQuote.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {item.description}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {item.quantity}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(item.unitPrice, currency)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-medium">
                                {formatCurrency(item.total, currency)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => deleteItem(item.id)}
                                  title="Delete item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}

                          {addingItem && (
                            <TableRow className="bg-muted/40">
                              <TableCell>
                                <Input
                                  value={newItem.description}
                                  onChange={(e) =>
                                    setNewItem((p) => ({
                                      ...p,
                                      description: e.target.value,
                                    }))
                                  }
                                  placeholder="Item description"
                                  className="h-8 text-sm"
                                  autoFocus
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={1}
                                  value={newItem.quantity}
                                  onChange={(e) =>
                                    setNewItem((p) => ({
                                      ...p,
                                      quantity: Number(e.target.value),
                                    }))
                                  }
                                  className="h-8 text-sm w-16 text-right tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={newItem.unitPrice}
                                  onChange={(e) =>
                                    setNewItem((p) => ({
                                      ...p,
                                      unitPrice: Number(e.target.value),
                                    }))
                                  }
                                  className="h-8 text-sm w-24 text-right tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-medium">
                                {formatCurrency(
                                  (Number(newItem.quantity) || 0) *
                                    (Number(newItem.unitPrice) || 0),
                                  currency
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    size="icon"
                                    className="h-7 w-7 brand-gradient text-white hover:opacity-95"
                                    onClick={addItem}
                                    title="Save item"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => {
                                      setAddingItem(false);
                                      setNewItem({
                                        description: "",
                                        quantity: 1,
                                        unitPrice: 0,
                                      });
                                    }}
                                    title="Cancel"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>

                      {!addingItem && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAddingItem(true)}
                          className="border-primary/30 text-primary hover:bg-primary/5"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add item
                        </Button>
                      )}

                      {/* Totals + discount / tax editor */}
                      <div className="grid sm:grid-cols-2 gap-4 pt-2">
                        {/* Discount + tax controls */}
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Discount</Label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={pricingDraft.discount}
                                onChange={(e) =>
                                  setPricingDraft((p) => ({
                                    ...p,
                                    discount: Number(e.target.value),
                                  }))
                                }
                                className="text-sm tabular-nums"
                              />
                              <Select
                                value={pricingDraft.discountType}
                                onValueChange={(v) =>
                                  setPricingDraft((p) => ({
                                    ...p,
                                    discountType: v as "percentage" | "flat",
                                  }))
                                }
                              >
                                <SelectTrigger className="w-32 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="percentage">
                                    % percent
                                  </SelectItem>
                                  <SelectItem value="flat">
                                    {currency} flat
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Tax rate (%)</Label>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={pricingDraft.taxRate}
                              onChange={(e) =>
                                setPricingDraft((p) => ({
                                  ...p,
                                  taxRate: Number(e.target.value),
                                }))
                              }
                              className="text-sm tabular-nums"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={savePricing}
                            disabled={savingPricing}
                            className="brand-gradient text-white hover:opacity-95"
                          >
                            {savingPricing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Save pricing
                          </Button>
                        </div>

                        {/* Totals summary */}
                        <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Subtotal
                            </span>
                            <span className="tabular-nums">
                              {formatCurrency(pricingPreview.subtotal, currency)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Discount
                              {pricingDraft.discountType === "percentage"
                                ? ` (${pricingDraft.discount || 0}%)`
                                : ""}
                            </span>
                            <span className="tabular-nums text-destructive">
                              −
                              {formatCurrency(
                                pricingPreview.discountAmount,
                                currency
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Tax ({pricingDraft.taxRate || 0}%)
                            </span>
                            <span className="tabular-nums">
                              {formatCurrency(pricingPreview.taxAmount, currency)}
                            </span>
                          </div>
                          <Separator className="my-1.5" />
                          <div className="flex items-center justify-between pt-1">
                            <span className="font-semibold text-base">Total</span>
                            <span className="tabular-nums font-bold text-lg text-primary">
                              {formatCurrency(pricingPreview.total, currency)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <AcceptanceCard
                    quote={activeQuote}
                    acceptance={acceptance}
                    setAcceptance={setAcceptance}
                    onSubmit={recordAcceptance}
                    saving={savingAcceptance}
                  />
                </>
              )}
            </TabsContent>

            {/* ─── Follow-ups tab ─── */}
            <TabsContent
              value="followups"
              className="flex-1 min-h-0 overflow-y-auto scroll-thin pr-1 -mr-1 mt-2 space-y-4"
            >
              {activeQuote && (
                <>
                  {/* Email draft generator */}
                  <Card className="shadow-none border-primary/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Mail className="h-4 w-4 text-primary" />
                        AI Email Draft
                      </CardTitle>
                      <CardDescription>
                        Generate a personalised email to send this proposal to
                        your client.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!emailDraft ? (
                        <Button
                          onClick={generateEmailDraft}
                          disabled={generatingEmail}
                          className="brand-gradient text-white hover:opacity-95"
                        >
                          {generatingEmail ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Generating…
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" />
                              Generate Email Draft
                            </>
                          )}
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Subject</Label>
                            <Input
                              value={emailDraft.subject}
                              onChange={(e) =>
                                setEmailDraft((p) =>
                                  p ? { ...p, subject: e.target.value } : p
                                )
                              }
                              className="text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Body</Label>
                            <Textarea
                              value={emailDraft.body}
                              onChange={(e) =>
                                setEmailDraft((p) =>
                                  p ? { ...p, body: e.target.value } : p
                                )
                              }
                              rows={8}
                              className="text-sm"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={buildMailto(
                                emailDraft.subject,
                                emailDraft.body,
                                activeQuote.acceptedByEmail
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button
                                className="brand-gradient text-white hover:opacity-95"
                                size="sm"
                              >
                                <Mail className="h-3.5 w-3.5" />
                                Open in Email
                              </Button>
                            </a>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                copyText(emailDraft.body);
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy body
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEmailDraft(null)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Regenerate
                            </Button>
                            {typeof emailDraft.tokens === "number" && (
                              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 ml-auto">
                                <Sparkles className="h-3 w-3" />
                                {emailDraft.tokens.toLocaleString()} tokens
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Opens your default email client with the draft
                            pre-filled. Review and edit before sending.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Add follow-up */}
                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Plus className="h-4 w-4 text-primary" />
                        Log a Follow-up
                      </CardTitle>
                      <CardDescription>
                        Track emails, calls, WhatsApp messages and notes for
                        this proposal.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Type</Label>
                          <Select
                            value={newFollowup.type}
                            onValueChange={(v) =>
                              setNewFollowup((p) => ({
                                ...p,
                                type: v as Followup["type"],
                              }))
                            }
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FOLLOWUP_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  <span className="flex items-center gap-2">
                                    <t.icon className="h-3.5 w-3.5" />
                                    {t.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Scheduled for (optional)
                          </Label>
                          <Input
                            type="datetime-local"
                            value={newFollowup.scheduledFor}
                            onChange={(e) =>
                              setNewFollowup((p) => ({
                                ...p,
                                scheduledFor: e.target.value,
                              }))
                            }
                            className="text-sm"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Content</Label>
                        <Textarea
                          value={newFollowup.content}
                          onChange={(e) =>
                            setNewFollowup((p) => ({
                              ...p,
                              content: e.target.value,
                            }))
                          }
                          rows={3}
                          placeholder="What was discussed / what needs to happen next…"
                          className="text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={addFollowup}
                        disabled={savingFollowup}
                        className="brand-gradient text-white hover:opacity-95"
                      >
                        {savingFollowup ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        Add follow-up
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Follow-ups list */}
                  <div className="space-y-2">
                    {activeQuote.followups.length === 0 ? (
                      <div className="text-center text-sm text-muted-foreground py-6 border rounded-lg border-dashed">
                        No follow-ups logged yet.
                      </div>
                    ) : (
                      activeQuote.followups.map((f) => (
                        <FollowupRow key={f.id} followup={f} />
                      ))
                    )}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          <Separator />

          <DialogFooter className="flex-col items-stretch sm:items-stretch gap-2 sm:flex-col">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => activeDoc && copyText(activeDoc.content)}
                disabled={!activeDoc}
                className="brand-gradient text-white hover:opacity-95 flex-1"
              >
                <Copy className="h-4 w-4" />
                Copy proposal text
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => activeDoc && downloadPDF(activeDoc)}
                disabled={!activeDoc}
                className="border-primary/30 text-primary hover:bg-primary/5"
              >
                <FileDown className="h-4 w-4" />
                Download PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => activeDoc && downloadMarkdown(activeDoc)}
                disabled={!activeDoc}
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">.md</span>
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-accent-foreground" />
                Export as PDF or Markdown — ready to send to your client.
              </span>
              {activeTokens && (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-accent-foreground" />
                  Token cost:{" "}
                  <span className="font-medium text-foreground">
                    {activeTokens.totalTokens.toLocaleString()}
                  </span>{" "}
                  total ·{" "}
                  <span className="font-medium text-foreground">
                    ${(activeTokens.totalTokens / 1000 * 0.002).toFixed(4)}
                  </span>{" "}
                  est.
                </span>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this quote?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the quote request for{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.clientName}
              </span>{" "}
              and all its generated proposals. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function QuoteCard({
  quote,
  onOpen,
  onRegenerate,
  onCopy,
  onDelete,
  regenerating,
  copying,
}: {
  quote: QuoteListItem;
  onOpen: () => void;
  onRegenerate: (e: React.MouseEvent) => void;
  onCopy: (e: React.MouseEvent) => void;
  onDelete: () => void;
  regenerating: boolean;
  copying: boolean;
}) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md hover:border-primary/40 transition-all py-4 group"
      onClick={onOpen}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate flex items-center gap-2">
              <span className="truncate">{quote.clientName}</span>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 mt-0.5 truncate">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {quote.companyName || "No company"}
              </span>
            </CardDescription>
          </div>
          <StatusBadge status={quote.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-2">
        <div className="flex items-center gap-1.5 text-sm">
          <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate font-medium">{quote.service}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {format(new Date(quote.createdAt), "dd MMM yyyy")}
          </span>
          {quote.timeline && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {quote.timeline}
            </span>
          )}
          {quote.budgetRange && (
            <span className="inline-flex items-center gap-1">
              <span className="font-medium">{quote.budgetRange}</span>
            </span>
          )}
          {typeof quote.total === "number" && quote.total > 0 && (
            <span className="inline-flex items-center gap-1 text-primary font-medium">
              {formatCurrency(quote.total, quote.currency || "USD")}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {quote.requirements}
        </p>
      </CardContent>
      <CardFooter className="pt-1 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRegenerate}
          disabled={regenerating}
          className="h-7"
        >
          {regenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Regenerate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCopy}
          disabled={copying}
          className="h-7 text-primary hover:text-primary hover:bg-primary/10"
          title="Duplicate proposal"
        >
          {copying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          Copy
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="h-7 ml-auto text-primary"
        >
          View
        </Button>
      </CardFooter>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "draft").toLowerCase();
  if (s === "generated") {
    return (
      <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15">
        <Sparkles className="h-3 w-3" />
        Generated
      </Badge>
    );
  }
  if (s === "sent") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
        <Send className="h-3 w-3" />
        Sent
      </Badge>
    );
  }
  if (s === "viewed") {
    return (
      <Badge className="bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/15">
        <Clock className="h-3 w-3" />
        Viewed
      </Badge>
    );
  }
  if (s === "accepted") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
        <CheckCircle2 className="h-3 w-3" />
        Accepted
      </Badge>
    );
  }
  if (s === "rejected") {
    return (
      <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15">
        <XCircle className="h-3 w-3" />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <AlertCircle className="h-3 w-3" />
      Draft
    </Badge>
  );
}

// ─── Status flow bar ──────────────────────────────────────────────────────

function StatusFlowBar({
  status,
  acceptedAt,
  onChange,
}: {
  status: string;
  acceptedAt: string | null;
  onChange: (status: string) => void;
}) {
  const current = (status || "draft").toLowerCase();
  const isAccepted = current === "accepted";
  const isRejected = current === "rejected";

  // For the flow, "rejected" is shown as a terminal branch off the "viewed"
  // step. The main flow is: draft → generated → sent → viewed → accepted.
  const flowIndex = Math.max(
    0,
    STATUS_FLOW.findIndex((s) => s.key === current)
  );

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-2">
      {STATUS_FLOW.map((step, idx) => {
        const Icon = step.icon;
        const isCurrent = current === step.key;
        const isPast = !isAccepted && !isRejected && idx < flowIndex;
        const isRejectedBranch = step.key === "accepted" && isRejected;
        return (
          <div key={step.key} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChange(step.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                isCurrent &&
                  "bg-primary text-primary-foreground shadow-sm",
                isPast &&
                  "bg-primary/10 text-primary hover:bg-primary/15",
                !isCurrent &&
                  !isPast &&
                  "text-muted-foreground hover:bg-muted",
                isRejectedBranch && "opacity-40"
              )}
              title={`Set status to ${step.label}`}
            >
              <Icon className="h-3 w-3" />
              {step.label}
              {isCurrent && isAccepted && acceptedAt && (
                <span className="text-[10px] opacity-90">
                  · {format(new Date(acceptedAt), "dd MMM")}
                </span>
              )}
            </button>
            {idx < STATUS_FLOW.length - 1 && (
              <span
                className={cn(
                  "h-px w-3 sm:w-5",
                  isPast || isCurrent
                    ? "bg-primary/40"
                    : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}

      {/* Rejected branch (separate pill) */}
      <button
        type="button"
        onClick={() => onChange("rejected")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ml-1",
          isRejected
            ? "bg-destructive text-white shadow-sm"
            : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        )}
        title="Mark as rejected"
      >
        <XCircle className="h-3 w-3" />
        Rejected
      </button>
    </div>
  );
}

// ─── Acceptance card ──────────────────────────────────────────────────────

function AcceptanceCard({
  quote,
  acceptance,
  setAcceptance,
  onSubmit,
  saving,
}: {
  quote: ActiveQuoteDetail;
  acceptance: {
    acceptedByName: string;
    acceptedByEmail: string;
    clientFeedback: string;
  };
  setAcceptance: React.Dispatch<
    React.SetStateAction<{
      acceptedByName: string;
      acceptedByEmail: string;
      clientFeedback: string;
    }>
  >;
  onSubmit: (status: "accepted" | "rejected") => void;
  saving: boolean;
}) {
  const isAccepted = quote.status === "accepted";
  const isRejected = quote.status === "rejected";

  return (
    <Card
      className={cn(
        "shadow-none",
        isAccepted && "border-emerald-500/40 bg-emerald-500/5",
        isRejected && "border-destructive/40 bg-destructive/5"
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {isAccepted ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : isRejected ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <User className="h-4 w-4 text-primary" />
          )}
          Client Acceptance
        </CardTitle>
        <CardDescription>
          {isAccepted
            ? "This proposal was accepted by the client."
            : isRejected
            ? "This proposal was rejected by the client."
            : "Record the client's decision when they respond."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(isAccepted || isRejected) &&
        quote.acceptedAt &&
        (quote.acceptedByName ||
          quote.acceptedByEmail ||
          quote.clientFeedback) ? (
          <div className="space-y-2 text-sm">
            {quote.acceptedByName && (
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Accepted by:</span>
                <span className="font-medium">{quote.acceptedByName}</span>
              </div>
            )}
            {quote.acceptedByEmail && (
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Email:</span>
                <a
                  href={`mailto:${quote.acceptedByEmail}`}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {quote.acceptedByEmail}
                </a>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">
                {isAccepted ? "Accepted" : "Rejected"}:
              </span>
              <span className="font-medium">
                {format(
                  new Date(quote.acceptedAt),
                  "dd MMM yyyy, HH:mm"
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                ({timeAgo(quote.acceptedAt)})
              </span>
            </div>
            {quote.clientFeedback && (
              <div className="rounded-md border bg-muted/30 p-2.5 text-sm">
                <p className="text-xs text-muted-foreground mb-1">
                  Client feedback:
                </p>
                <p className="whitespace-pre-wrap">{quote.clientFeedback}</p>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSubmit(isAccepted ? "rejected" : "accepted")}
              disabled={saving}
              className="mt-1"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Change decision
            </Button>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Accepted by (name)</Label>
                <Input
                  value={acceptance.acceptedByName}
                  onChange={(e) =>
                    setAcceptance((p) => ({
                      ...p,
                      acceptedByName: e.target.value,
                    }))
                  }
                  placeholder="Client name"
                  className="text-sm"
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Accepted by (email)</Label>
                <Input
                  type="email"
                  value={acceptance.acceptedByEmail}
                  onChange={(e) =>
                    setAcceptance((p) => ({
                      ...p,
                      acceptedByEmail: e.target.value,
                    }))
                  }
                  placeholder="client@company.com"
                  className="text-sm"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Client feedback</Label>
              <Textarea
                value={acceptance.clientFeedback}
                onChange={(e) =>
                  setAcceptance((p) => ({
                    ...p,
                    clientFeedback: e.target.value,
                  }))
                }
                placeholder="Notes from the client — concerns, requests, conditions…"
                rows={3}
                className="text-sm"
                disabled={saving}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => onSubmit("accepted")}
                disabled={saving}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Mark as Accepted
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSubmit("rejected")}
                disabled={saving}
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Mark as Rejected
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Follow-up row ────────────────────────────────────────────────────────

function FollowupRow({ followup }: { followup: Followup }) {
  const typeMeta =
    FOLLOWUP_TYPES.find((t) => t.value === followup.type) ||
    FOLLOWUP_TYPES[3];
  const Icon = typeMeta.icon;
  const isCompleted = !!followup.completedAt;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "py-0",
              followup.type === "email" &&
                "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
              followup.type === "whatsapp" &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
              followup.type === "call" &&
                "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
              followup.type === "note" &&
                "bg-muted text-muted-foreground border-border"
            )}
          >
            <Icon className="h-3 w-3" />
            {typeMeta.label}
          </Badge>
          {isCompleted && (
            <Badge
              variant="outline"
              className="py-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
            >
              <Check className="h-3 w-3" />
              Done
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {timeAgo(followup.createdAt)}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{followup.content}</p>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {followup.createdByName && (
          <span className="inline-flex items-center gap-1">
            <User className="h-3 w-3" />
            {followup.createdByName}
          </span>
        )}
        {followup.scheduledFor && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Scheduled: {format(new Date(followup.scheduledFor), "dd MMM yyyy, HH:mm")}
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyHistory() {
  return (
    <Card className="border-dashed py-10">
      <CardContent className="flex flex-col items-center justify-center text-center gap-3 py-6">
        <div className="h-14 w-14 rounded-full bg-accent/20 flex items-center justify-center">
          <FileText className="h-7 w-7 text-accent-foreground" />
        </div>
        <div>
          <p className="font-medium">No proposals yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Fill in the brief on the left and click{" "}
            <span className="font-medium text-foreground">Generate Proposal</span>{" "}
            to create your first AI-drafted proposal.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
          <Plus className="h-3.5 w-3.5" />
          Try it now — it takes seconds.
        </div>
      </CardContent>
    </Card>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="py-4">
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-1/3 mt-1" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
