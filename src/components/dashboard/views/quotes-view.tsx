"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlertCircle,
  Building2,
  Calendar,
  Clock,
  Copy,
  Download,
  FileDown,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  User,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  latestDocument: GeneratedDocument | null;
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

// ─── Main component ───────────────────────────────────────────────────────

export function QuotesView({ user: _user }: { user: User }) {
  // Form state
  const [clientName, setClientName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [serviceChoice, setServiceChoice] = useState<string>("");
  const [serviceOther, setServiceOther] = useState("");
  const [requirements, setRequirements] = useState("");
  const [budgetRange, setBudgetRange] = useState<string>("");
  const [timeline, setTimeline] = useState<string>("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // History state
  const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Active dialog (view proposal) state
  const [viewOpen, setViewOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<GeneratedDocument | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeTokens, setActiveTokens] = useState<TokenInfo | null>(null);
  const [activeMeta, setActiveMeta] = useState<{
    clientName?: string;
    createdAt?: string;
  } | null>(null);

  // Regenerate state (track which quote is regenerating)
  const [regenId, setRegenId] = useState<string | null>(null);

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

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  // ─── Submit form ────────────────────────────────────────────────────

  const resolvedService =
    serviceChoice === "Other" ? serviceOther.trim() : serviceChoice;

  function resetForm() {
    setClientName("");
    setCompanyName("");
    setServiceChoice("");
    setServiceOther("");
    setRequirements("");
    setBudgetRange("");
    setTimeline("");
    setNotes("");
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
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast.success("Proposal generated");

      // Show the result in the Dialog
      setActiveDoc({
        id: data.document.id,
        title: data.document.title,
        content: data.document.content,
        type: data.document.type,
        createdAt: data.document.createdAt,
      });
      setActiveTokens(data.tokens ?? null);
      setActiveMeta({
        clientName: data.quote?.clientName,
        createdAt: data.quote?.createdAt,
      });
      setActiveLoading(false);
      setViewOpen(true);

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

  // ─── Open quote detail ─────────────────────────────────────────────

  async function openQuote(quote: QuoteListItem) {
    setViewOpen(true);
    setActiveDoc(null);
    setActiveTokens(null);
    setActiveLoading(true);
    setActiveMeta({
      clientName: quote.clientName,
      createdAt: quote.createdAt,
    });
    try {
      const res = await fetch(`/api/quotes/${quote.id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const latest = data.quote?.documents?.[0];
      if (latest) {
        setActiveDoc(latest);
      } else {
        toast.error("No generated proposal found. Try Regenerate.");
        setViewOpen(false);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load proposal");
      setViewOpen(false);
    } finally {
      setActiveLoading(false);
    }
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
      setActiveDoc(data.document);
      setActiveTokens(data.tokens ?? null);
      setActiveMeta({
        clientName: quote.clientName,
        createdAt: data.document.createdAt,
      });
      setViewOpen(true);
      loadQuotes();
    } catch (err: any) {
      toast.error(err?.message || "Failed to regenerate proposal");
    } finally {
      setRegenId(null);
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
                  onDelete={() => setDeleteTarget(q)}
                  regenerating={regenId === q.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Proposal Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <span className="truncate">{activeDoc?.title || "Proposal"}</span>
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {activeMeta?.clientName && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {activeMeta.clientName}
                </span>
              )}
              {activeMeta?.createdAt && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(activeMeta.createdAt), "dd MMM yyyy, HH:mm")}
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

          <Separator />

          <div className="flex-1 overflow-y-auto scroll-thin pr-1 -mr-1">
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
                      <ul className="list-disc pl-5 my-2 space-y-0.5" {...props} />
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
                      <strong className="font-semibold text-foreground" {...props} />
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
          </div>

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
                onClick={() => activeDoc && downloadMarkdown(activeDoc)}
                disabled={!activeDoc}
              >
                <Download className="h-4 w-4" />
                Download .md
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FileDown className="h-3 w-3" />
                PDF export coming soon.
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
  onDelete,
  regenerating,
}: {
  quote: QuoteListItem;
  onOpen: () => void;
  onRegenerate: (e: React.MouseEvent) => void;
  onDelete: () => void;
  regenerating: boolean;
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
  if (status === "generated") {
    return (
      <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15">
        <Sparkles className="h-3 w-3" />
        Generated
      </Badge>
    );
  }
  if (status === "sent") {
    return (
      <Badge className="bg-accent/30 text-accent-foreground border-accent/40 hover:bg-accent/30">
        Sent
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
