"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Search,
  Sparkles,
  Send,
  Copy,
  FileUp,
  MessageSquare,
  Loader2,
  RefreshCw,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  Layers,
  HelpCircle,
  CheckCircle2,
  Info,
  X,
  FileType2,
  Upload,
  Type,
  Check,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface DocUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type SourceType = "text" | "pdf" | "docx" | "txt";
type DocStatus = "active" | "processing" | "archived";

interface DocumentListItem {
  id: string;
  title: string;
  category: string;
  sourceType: SourceType;
  fileName: string | null;
  fileSize: number | null;
  summary: string | null;
  status: DocStatus;
  chunkCount: number;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface DocumentChunk {
  id: string;
  content: string;
  chunkIndex: number;
}

interface DocumentQuestion {
  id: string;
  question: string;
  answer: string | null;
  createdAt: string;
  /** Optional fields populated when a new question is asked in-session. */
  chunksUsed?: number;
  chunkPreview?: string[];
  tokens?: number;
  /** True when the AI returned its fallback "could not find" message. */
  fallback?: boolean;
}

interface DocumentDetail {
  id: string;
  title: string;
  category: string;
  sourceType: SourceType;
  content: string;
  fileName: string | null;
  fileSize: number | null;
  summary: string | null;
  status: DocStatus;
  createdAt: string;
  updatedAt: string;
  chunks: DocumentChunk[];
  questions: DocumentQuestion[];
}

interface AskResponse {
  answer: string;
  chunksUsed: number;
  chunkPreview?: string[];
  questionId: string;
  tokens?: number;
}

interface SummaryResponse {
  summary: string;
  tokens: number;
}

const SOURCE_TYPE_OPTIONS: {
  value: SourceType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "text", label: "Text", icon: FileText },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "docx", label: "DOCX", icon: FileText },
  { value: "txt", label: "TXT", icon: FileText },
];

const CATEGORY_SUGGESTIONS = [
  "Legal",
  "Sales",
  "Support",
  "Technical",
  "Marketing",
  "General",
];

const FALLBACK_MARKER =
  "I could not find enough information in the selected document to answer that confidently.";

const EXAMPLE_QUESTIONS = [
  "What is this document about?",
  "Summarize the key points.",
  "What are the main dates mentioned?",
];

function relativeTime(iso: string) {
  try {
    const t = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - t);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(text: string, max = 140) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + "…";
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SourceBadge({ sourceType }: { sourceType: SourceType }) {
  const opt = SOURCE_TYPE_OPTIONS.find((o) => o.value === sourceType);
  const label = opt?.label || sourceType;

  // Icon + color coding per spec:
  // - PDF:  red badge, FileText icon
  // - DOCX: blue badge, FileText icon
  // - TXT:  muted badge, FileText icon
  // - text (manual): primary badge, Type icon
  const styles: Record<
    SourceType,
    { icon: React.ComponentType<{ className?: string }>; className: string }
  > = {
    pdf: {
      icon: FileText,
      className:
        "border-red-300/70 bg-red-500/5 text-red-600 dark:border-red-900/60 dark:text-red-400",
    },
    docx: {
      icon: FileText,
      className:
        "border-blue-300/70 bg-blue-500/5 text-blue-600 dark:border-blue-900/60 dark:text-blue-400",
    },
    txt: {
      icon: FileText,
      className: "border-muted bg-muted/40 text-muted-foreground",
    },
    text: {
      icon: Type,
      className:
        "border-primary/30 bg-primary/5 text-primary",
    },
  };
  const cfg = styles[sourceType] || styles.text;
  const Icon = cfg.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium", cfg.className)}
    >
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: DocStatus }) {
  if (status === "active") {
    return (
      <Badge className="bg-accent text-accent-foreground hover:bg-accent/90 border-transparent gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-foreground/70" />
        Active
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        Processing
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      Archived
    </Badge>
  );
}

const EMPTY_FORM: {
  title: string;
  category: string;
  content: string;
  sourceType: SourceType;
} = {
  title: "",
  category: "General",
  content: "",
  sourceType: "text",
};

export function DocumentsView({ user: _user }: { user: DocUser }) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Toolbar
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // New document dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  // Upload dialog (file → extract → auto-chunks)
  const [uploadOpen, setUploadOpen] = useState(false);

  // Detail dialog
  const [detailId, setDetailId] = useState<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const fetchInFlight = useRef(false);

  // Debounced search (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadDocuments = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (fetchInFlight.current) return;
      fetchInFlight.current = true;
      if (!opts?.silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (categoryFilter !== "all") params.set("category", categoryFilter);
        const url = `/api/documents${params.toString() ? `?${params}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load documents");
        const data = await res.json();
        setDocuments(data.documents || []);
      } catch (e: any) {
        toast.error(e?.message || "Could not load documents");
      } finally {
        setLoading(false);
        fetchInFlight.current = false;
      }
    },
    [debouncedSearch, categoryFilter]
  );

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Derived: unique categories from the loaded list
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    documents.forEach((d) => d.category && set.add(d.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  async function handleCreate() {
    if (!form.title.trim() || form.title.trim().length < 2) {
      toast.error("Title must be at least 2 characters");
      return;
    }
    if (!form.category.trim()) {
      toast.error("Category is required");
      return;
    }
    if (!form.content.trim()) {
      toast.error("Content is required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          content: form.content,
          category: form.category.trim(),
          sourceType: form.sourceType,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create document");
      }
      const newId: string | undefined = data?.document?.id;
      toast.success("Document created", {
        description: form.title.trim(),
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await loadDocuments({ silent: true });
      // Open the freshly-created document
      if (newId) {
        setDetailId(newId);
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not create document");
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toast.success("Document deleted", {
        description: deleteTarget.title,
      });
      setDeleteTarget(null);
      await loadDocuments({ silent: true });
    } catch (e: any) {
      toast.error(e?.message || "Could not delete document");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadDocuments({ silent: true });
    setRefreshing(false);
  }

  const visibleCount = documents.length;
  const hasFilters =
    !!debouncedSearch || categoryFilter !== "all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                AI Document Assistant
              </h1>
              <p className="text-sm text-muted-foreground">
                Upload documents and ask AI questions based on their content.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
          >
            <RefreshCw
              className={cn("size-4", refreshing && "animate-spin")}
            />
          </Button>
          <Button
            variant="outline"
            onClick={() => setUploadOpen(true)}
            className="gap-2 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            title="Upload a PDF, DOCX, or TXT file — text is extracted automatically"
          >
            <Upload className="size-4" />
            Upload File
          </Button>
          <Button
            onClick={() => {
              setForm(EMPTY_FORM);
              setCreateOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="size-4" />
            New Document
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <Card className="py-4">
        <CardContent className="px-4 py-0 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by title or content…"
                className="pl-9 pr-9"
                aria-label="Search documents"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground rounded p-1"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="md:w-56">
              <Select
                value={categoryFilter}
                onValueChange={(v) => setCategoryFilter(v)}
              >
                <SelectTrigger className="w-full" aria-label="Filter by category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {hasFilters && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {visibleCount} {visibleCount === 1 ? "document" : "documents"}{" "}
                match
              </span>
              <button
                onClick={() => {
                  setSearchInput("");
                  setDebouncedSearch("");
                  setCategoryFilter("all");
                }}
                className="text-primary hover:underline"
              >
                Reset filters
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="py-4">
              <CardContent className="px-4 py-0 space-y-3">
                <Skeleton className="h-5 w-2/5" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          onCreate={() => {
            setForm(EMPTY_FORM);
            setCreateOpen(true);
          }}
          hasFilters={hasFilters}
        />
      ) : (
        <div className="max-h-[70vh] overflow-y-auto scroll-thin pr-1 -mr-1 space-y-3">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              onOpen={() => setDetailId(doc.id)}
              onDelete={() => setDeleteTarget(doc)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setForm(EMPTY_FORM);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="size-5 text-primary" />
              New Document
            </DialogTitle>
            <DialogDescription>
              Paste document text and the AI will automatically split it into
              searchable sections for Q&amp;A.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="doc-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. Service Agreement 2025"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="doc-category">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="doc-category"
                  list="doc-category-options"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  placeholder="General"
                />
                <datalist id="doc-category-options">
                  {CATEGORY_SUGGESTIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Type or pick a suggested category.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Source Type</Label>
                <Select
                  value={form.sourceType}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, sourceType: v as SourceType }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className="inline-flex items-center gap-2">
                          <o.icon className="size-3.5" />
                          {o.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used as a label for filtering.
                </p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="doc-content">
                Content <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="doc-content"
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
                rows={8}
                className="min-h-[180px] resize-y font-mono text-[13px] leading-relaxed"
                placeholder="Paste the full document text here. The AI will split it into chunks automatically."
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{form.content.length} characters</span>
              </div>
            </div>

            <div className="rounded-lg border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <Info className="size-3.5 mt-0.5 shrink-0" />
              <span>
                Tip: use the{" "}
                <span className="font-medium">Upload File</span> button to
                auto-extract text from PDF, DOCX, or TXT files. Otherwise,
                paste the text below and the AI will still split it into
                searchable chunks.
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="gap-2"
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload dialog (file → extract → auto-chunks) */}
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(newId) => {
          setDetailId(newId);
        }}
        onListRefresh={() => loadDocuments({ silent: true })}
      />

      {/* Detail dialog */}
      <DocumentDetailDialog
        docId={detailId}
        onClose={() => setDetailId(null)}
        onDeleted={() => {
          setDetailId(null);
          loadDocuments({ silent: true });
        }}
        onUpdated={() => loadDocuments({ silent: true })}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.title}
              </span>{" "}
              along with all of its chunks and Q&amp;A history. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={deleting}
              className="gap-2 bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────────── Document Card ───────────────────────────── */

function DocumentCard({
  doc,
  onOpen,
  onDelete,
}: {
  doc: DocumentListItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group py-0 transition-shadow hover:shadow-md hover:border-primary/30">
      <CardContent className="px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <button
              onClick={onOpen}
              className="text-left group/title w-full"
            >
              <h3 className="font-semibold text-base leading-snug line-clamp-1 group-hover/title:text-primary transition-colors">
                {doc.title}
              </h3>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="gap-1 font-medium border-primary/30 text-primary"
              >
                {doc.category}
              </Badge>
              <SourceBadge sourceType={doc.sourceType} />
              <StatusBadge status={doc.status} />
              {doc.fileName && (
                <Badge
                  variant="outline"
                  className="gap-1 text-muted-foreground font-normal"
                >
                  <FileType2 className="size-3" />
                  <span className="max-w-[140px] truncate">{doc.fileName}</span>
                </Badge>
              )}
            </div>
            {doc.summary && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                {truncate(doc.summary, 140)}
              </p>
            )}
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Layers className="size-3" />
                {doc.chunkCount} {doc.chunkCount === 1 ? "chunk" : "chunks"}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3" />
                {doc.questionCount}{" "}
                {doc.questionCount === 1 ? "question" : "questions"}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span>Updated {relativeTime(doc.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={onOpen}
              title="Open"
            >
              <FileText className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Document Detail Dialog ──────────────────────── */

function DocumentDetailDialog({
  docId,
  onClose,
  onDeleted,
  onUpdated,
}: {
  docId: string | null;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("content");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);

  // Q&A tab state
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [questions, setQuestions] = useState<DocumentQuestion[]>([]);
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>(
    {}
  );

  // Summary tab state
  const [generatingSummary, setGeneratingSummary] = useState(false);

  // Delete-from-detail state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset state when a different doc is opened
  useEffect(() => {
    if (!docId) {
      setDoc(null);
      setTitleDraft("");
      setEditingTitle(false);
      setQuestions([]);
      setQuestion("");
      setActiveTab("content");
      setExpandedChunks({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load document");
        const data = await res.json();
        if (cancelled) return;
        const d: DocumentDetail = data.document;
        setDoc(d);
        setTitleDraft(d.title);
        setQuestions(d.questions || []);
      } catch (e: any) {
        toast.error(e?.message || "Could not load document");
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  async function saveTitle() {
    if (!doc) return;
    const next = titleDraft.trim();
    if (next.length < 2) {
      toast.error("Title must be at least 2 characters");
      setTitleDraft(doc.title);
      setEditingTitle(false);
      return;
    }
    if (next === doc.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Update failed");
      setDoc((d) => (d ? { ...d, title: next } : d));
      toast.success("Title updated");
      onUpdated();
    } catch (e: any) {
      toast.error(e?.message || "Could not update title");
      setTitleDraft(doc.title);
    } finally {
      setSavingTitle(false);
      setEditingTitle(false);
    }
  }

  async function archiveToggle() {
    if (!doc) return;
    const next: DocStatus = doc.status === "archived" ? "active" : "archived";
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Update failed");
      setDoc((d) => (d ? { ...d, status: next } : d));
      toast.success(next === "archived" ? "Document archived" : "Document restored");
      onUpdated();
    } catch (e: any) {
      toast.error(e?.message || "Could not update status");
    }
  }

  async function handleAsk() {
    if (!doc) return;
    const q = question.trim();
    if (q.length < 2) {
      toast.error("Question must be at least 2 characters");
      return;
    }
    setAsking(true);
    // Optimistically show a placeholder so the user sees the question immediately.
    const placeholderId = `placeholder-${Date.now()}`;
    setQuestions((prev) => [
      {
        id: placeholderId,
        question: q,
        answer: null,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setQuestion("");
    try {
      const res = await fetch(`/api/documents/${doc.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data: AskResponse = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data as any)?.error || "Failed to get an answer");
      }
      const isFallback =
        data.chunksUsed === 0 || data.answer === FALLBACK_MARKER;
      const enriched: DocumentQuestion = {
        id: data.questionId || placeholderId,
        question: q,
        answer: data.answer,
        createdAt: new Date().toISOString(),
        chunksUsed: data.chunksUsed,
        chunkPreview: data.chunkPreview,
        tokens: data.tokens,
        fallback: isFallback,
      };
      setQuestions((prev) =>
        prev.map((item) => (item.id === placeholderId ? enriched : item))
      );
      // Auto-expand chunks for the freshest answer
      if (data.chunkPreview && data.chunkPreview.length > 0) {
        setExpandedChunks((m) => ({
          ...m,
          [enriched.id]: true,
        }));
      }
      onUpdated();
    } catch (e: any) {
      // Replace placeholder with an error marker
      setQuestions((prev) =>
        prev.map((item) =>
          item.id === placeholderId
            ? {
                ...item,
                answer:
                  "Something went wrong while contacting the AI. Please try again.",
                fallback: true,
              }
            : item
        )
      );
      toast.error(e?.message || "Could not get an answer");
    } finally {
      setAsking(false);
    }
  }

  async function handleGenerateSummary() {
    if (!doc) return;
    setGeneratingSummary(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/summary`, {
        method: "POST",
      });
      const data: SummaryResponse = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data as any)?.error || "Failed to generate summary");
      }
      setDoc((d) =>
        d
          ? {
              ...d,
              summary: data.summary,
            }
          : d
      );
      toast.success("Summary generated", {
        description: `${data.tokens} tokens used`,
      });
      onUpdated();
    } catch (e: any) {
      toast.error(e?.message || "Could not generate summary");
    } finally {
      setGeneratingSummary(false);
    }
  }

  async function handleDeleteFromDetail() {
    if (!doc) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toast.success("Document deleted", { description: doc.title });
      setDeleteConfirmOpen(false);
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message || "Could not delete document");
    } finally {
      setDeleting(false);
    }
  }

  function copyToClipboard(text: string, label = "Copied to clipboard") {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(label))
      .catch(() => toast.error("Could not copy"));
  }

  const open = !!docId;
  const chunkCount = doc?.chunks?.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col gap-4">
        {/* Header */}
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="flex-1 min-w-0 space-y-1.5">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTitle();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setTitleDraft(doc?.title || "");
                        setEditingTitle(false);
                      }
                    }}
                    className="text-lg font-semibold h-9"
                    autoFocus
                    disabled={savingTitle}
                  />
                  <Button
                    size="sm"
                    onClick={saveTitle}
                    disabled={savingTitle}
                    className="gap-1.5 shrink-0"
                  >
                    {savingTitle ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Save
                  </Button>
                </div>
              ) : (
                <DialogTitle
                  className="text-lg leading-snug flex items-center gap-2 group/title cursor-text"
                  onClick={() => setEditingTitle(true)}
                  title="Click to edit title"
                >
                  <span className="truncate">{doc?.title}</span>
                  <Pencil className="size-3.5 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
                </DialogTitle>
              )}
              <DialogDescription className="sr-only">
                Document detail
              </DialogDescription>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {doc && (
                  <Badge
                    variant="outline"
                    className="gap-1 font-medium border-primary/30 text-primary"
                  >
                    {doc.category}
                  </Badge>
                )}
                {doc && <SourceBadge sourceType={doc.sourceType} />}
                {doc && <StatusBadge status={doc.status} />}
                {doc?.fileName && (
                  <Badge
                    variant="outline"
                    className="gap-1 text-muted-foreground font-normal"
                  >
                    <FileType2 className="size-3" />
                    <span className="max-w-[180px] truncate">
                      {doc.fileName}
                    </span>
                  </Badge>
                )}
                {doc?.fileSize != null && (
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(doc.fileSize)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {loading || !doc ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            Loading document…
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 min-h-0 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList>
                <TabsTrigger value="content" className="gap-1.5">
                  <FileText className="size-3.5" />
                  Content
                </TabsTrigger>
                <TabsTrigger value="qa" className="gap-1.5">
                  <MessageSquare className="size-3.5" />
                  AI Q&amp;A
                  {questions.length > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5 min-w-[1.25rem] h-4">
                      {questions.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="summary" className="gap-1.5">
                  <Sparkles className="size-3.5" />
                  Summary
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={archiveToggle}
                  className="gap-1.5"
                >
                  {doc.status === "archived" ? "Restore" : "Archive"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/30"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </div>
            </div>

            {/* ───── Content tab ───── */}
            <TabsContent
              value="content"
              className="flex-1 min-h-0 data-[state=inactive]:hidden"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
                    <Layers className="size-3.5" />
                    {chunkCount} {chunkCount === 1 ? "chunk" : "chunks"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-3.5" />
                    {doc.content.length.toLocaleString()} characters
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Updated {relativeTime(doc.updatedAt)}</span>
                </div>
                <ScrollArea className="h-[55vh] rounded-lg border bg-muted/30">
                  <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans p-4">
                    {doc.content}
                  </pre>
                </ScrollArea>
              </div>
            </TabsContent>

            {/* ───── AI Q&A tab ───── */}
            <TabsContent
              value="qa"
              className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col gap-3"
            >
              <div className="rounded-lg border bg-primary/[0.03] border-primary/20 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <Info className="size-3.5 mt-0.5 shrink-0 text-primary" />
                <span>
                  AI answers are based{" "}
                  <span className="font-medium text-foreground">ONLY</span> on
                  this document&apos;s content. It will not use outside
                  knowledge.
                </span>
              </div>

              {/* Question input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!asking) handleAsk();
                }}
                className="space-y-2"
              >
                <Label htmlFor="doc-question" className="sr-only">
                  Ask a question
                </Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Textarea
                    id="doc-question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a question about this document…"
                    rows={2}
                    className="flex-1 resize-none min-h-[60px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!asking) handleAsk();
                      }
                    }}
                    disabled={asking}
                  />
                  <Button
                    type="submit"
                    disabled={asking || question.trim().length < 2}
                    className="gap-2 sm:self-end"
                  >
                    {asking ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    Ask
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Try:</span>
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuestion(q)}
                      disabled={asking}
                      className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </form>

              <Separator />

              {/* Q&A list */}
              <div className="flex-1 min-h-0 overflow-y-auto scroll-thin pr-1 -mr-1 space-y-3">
                {questions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-10">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <HelpCircle className="size-5 text-primary" />
                    </div>
                    <p className="text-sm font-medium">
                      Ask a question about this document to get started.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      The AI retrieves the most relevant sections and answers
                      using only this document.
                    </p>
                  </div>
                ) : (
                  questions.map((qa) => (
                    <QaCard
                      key={qa.id}
                      qa={qa}
                      expanded={!!expandedChunks[qa.id]}
                      onToggle={() =>
                        setExpandedChunks((m) => ({
                          ...m,
                          [qa.id]: !m[qa.id],
                        }))
                      }
                      onCopy={(text) =>
                        copyToClipboard(text, "Answer copied")
                      }
                    />
                  ))
                )}
              </div>
            </TabsContent>

            {/* ───── Summary tab ───── */}
            <TabsContent
              value="summary"
              className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col gap-3"
            >
              {doc.summary ? (
                <div className="space-y-3 flex-1 min-h-0 flex flex-col">
                  <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-primary">
                        <Sparkles className="size-3.5" />
                        AI-Generated Summary
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          copyToClipboard(doc.summary || "", "Summary copied")
                        }
                        title="Copy summary"
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                    <ScrollArea className="max-h-[50vh]">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {doc.summary}
                      </p>
                    </ScrollArea>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      Last generated {relativeTime(doc.updatedAt)}
                    </span>
                    <Button
                      variant="outline"
                      onClick={handleGenerateSummary}
                      disabled={generatingSummary}
                      className="gap-2"
                    >
                      {generatingSummary ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Regenerate
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center py-12">
                  <div className="h-14 w-14 rounded-2xl brand-gradient flex items-center justify-center mb-4 text-white shadow-sm">
                    <Sparkles className="size-7" />
                  </div>
                  <h3 className="font-semibold text-lg">No summary yet</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Generate an AI summary to quickly understand this document.
                  </p>
                  <Button
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                    className="mt-4 gap-2"
                  >
                    {generatingSummary ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {generatingSummary
                      ? "Generating summary…"
                      : "Generate Summary"}
                  </Button>
                </div>
              )}
              {generatingSummary && doc.summary && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Regenerating…
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>

      {/* Inline delete confirmation (kept outside DialogContent so the
          underlying detail dialog stays mounted) */}
      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">{doc?.title}</span>{" "}
              along with all of its chunks and Q&amp;A history. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteFromDetail();
              }}
              disabled={deleting}
              className="gap-2 bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/* ───────────────────────────── Q&A Card ───────────────────────────── */

function QaCard({
  qa,
  expanded,
  onToggle,
  onCopy,
}: {
  qa: DocumentQuestion;
  expanded: boolean;
  onToggle: () => void;
  onCopy: (text: string) => void;
}) {
  const loading = qa.answer == null;
  const isFallback = !!qa.fallback;
  const hasChunks =
    !!qa.chunkPreview && qa.chunkPreview.length > 0 && !isFallback;

  return (
    <Card
      className={cn(
        "py-0 transition-colors",
        loading && "border-primary/30 bg-primary/[0.02]"
      )}
    >
      <CardContent className="px-4 py-3 space-y-3">
        {/* Question */}
        <div className="flex items-start gap-2">
          <div className="shrink-0 size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">
            Q
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug whitespace-pre-wrap break-words">
              {qa.question}
            </p>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {relativeTime(qa.createdAt)}
            </div>
          </div>
        </div>

        {/* Answer */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground pl-8">
            <Loader2 className="size-3.5 animate-spin" />
            Searching document…
          </div>
        ) : isFallback ? (
          <div className="ml-8 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{qa.answer}</span>
          </div>
        ) : (
          <div className="ml-8 rounded-lg border bg-muted/40 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="shrink-0 size-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-[11px] font-semibold">
                A
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words flex-1 min-w-0">
                {qa.answer}
              </p>
            </div>

            {/* Meta row */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                {typeof qa.chunksUsed === "number" && (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3" />
                    Based on {qa.chunksUsed}{" "}
                    {qa.chunksUsed === 1 ? "section" : "sections"}
                  </span>
                )}
                {typeof qa.tokens === "number" && qa.tokens > 0 && (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{qa.tokens} tokens</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onCopy(qa.answer || "")}
                  title="Copy answer"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* Collapsible chunk previews */}
            {hasChunks && (
              <Collapsible open={expanded} onOpenChange={onToggle}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                  >
                    {expanded ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {expanded ? "Hide sections" : "Show source sections"}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {qa.chunkPreview!.map((chunk, i) => (
                    <div
                      key={i}
                      className="rounded-md border bg-background p-2.5 text-xs leading-relaxed text-muted-foreground"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70 mb-1">
                        Section {i + 1}
                      </div>
                      <p className="whitespace-pre-wrap break-words">
                        {chunk}
                      </p>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── Empty State ───────────────────────────── */

function EmptyState({
  onCreate,
  hasFilters,
}: {
  onCreate: () => void;
  hasFilters: boolean;
}) {
  if (hasFilters) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Search className="size-5 text-muted-foreground" />
          </div>
          <h3 className="font-medium">No matching documents</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Try adjusting your search or category filter to find what you&apos;re
            looking for.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-2xl brand-gradient flex items-center justify-center mb-4 text-white shadow-sm">
          <FileText className="size-7" />
        </div>
        <h3 className="font-semibold text-lg">No documents yet</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          Upload your first document — paste the text, and the AI will split it
          into searchable sections so you can ask questions about its content.
        </p>
        <Button onClick={onCreate} className="mt-4 gap-2">
          <Plus className="size-4" />
          Create your first document
        </Button>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── Upload Dialog ───────────────────────────── */

const UPLOAD_ACCEPTED_EXTS = ["pdf", "docx", "txt"] as const;
const UPLOAD_ACCEPT_ATTR = ".pdf,.docx,.txt";
const UPLOAD_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

type UploadStage = {
  label: string;
  /** Progress value the bar settles at when this stage becomes active. */
  progress: number;
};

function buildUploadStages(ext: string): UploadStage[] {
  const extractLabel =
    ext === "pdf"
      ? "Extracting text from PDF…"
      : ext === "docx"
        ? "Extracting text from DOCX…"
        : ext === "txt"
          ? "Reading text file…"
          : "Extracting text…";
  return [
    { label: "Uploading file…", progress: 15 },
    { label: extractLabel, progress: 55 },
    { label: "Splitting into chunks…", progress: 85 },
  ];
}

function getFileKind(
  file: File
): "pdf" | "docx" | "txt" | "unknown" {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt") return "txt";
  return "unknown";
}

function FileKindIcon({ kind, className }: { kind: string; className?: string }) {
  // PDF=red, DOCX=blue, TXT=muted, fallback=muted
  const colorClass =
    kind === "pdf"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : kind === "docx"
        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
        : "bg-muted text-muted-foreground";
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md",
        colorClass,
        className
      )}
    >
      <FileText className="size-5" />
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
  onListRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (docId: string) => void;
  onListRefresh: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Progress simulation
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when the dialog closes
  useEffect(() => {
    if (!open) {
      // cancel any pending timers/intervals
      stageTimers.current.forEach(clearTimeout);
      stageTimers.current = [];
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      setFile(null);
      setTitle("");
      setCategory("General");
      setUploading(false);
      setError(null);
      setDragOver(false);
      setStageIndex(0);
      setProgress(0);
    }
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stageTimers.current.forEach(clearTimeout);
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  function validateFile(f: File): string | null {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    if (!UPLOAD_ACCEPTED_EXTS.includes(ext as any)) {
      return `Unsupported file type: .${ext || "unknown"}. Supported: PDF, DOCX, TXT.`;
    }
    if (f.size > UPLOAD_MAX_SIZE) {
      return "File too large. Maximum size is 10MB.";
    }
    if (f.size === 0) {
      return "The selected file is empty.";
    }
    return null;
  }

  function handleFileSelect(f: File | null) {
    if (!f) return;
    setError(null);
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setFile(f);
    // Auto-fill title from filename (without extension) only if the user
    // hasn't typed one yet.
    setTitle((prev) =>
      prev.trim() ? prev : f.name.replace(/\.[^.]+$/, "")
    );
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (uploading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (uploading) return;
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleBrowseClick() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  function clearSelectedFile() {
    setFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUpload() {
    if (!file) {
      setError("Please select a file to upload.");
      return;
    }
    if (title.trim().length < 2) {
      setError("Title must be at least 2 characters.");
      return;
    }
    if (!category.trim()) {
      setError("Category is required.");
      return;
    }

    setError(null);
    setUploading(true);

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const stages = buildUploadStages(ext);
    setStageIndex(0);
    setProgress(stages[0].progress);

    // Schedule transitions between stages to give visual feedback while the
    // backend is busy extracting and chunking.
    stageTimers.current.push(
      setTimeout(() => {
        setStageIndex(1);
        setProgress(stages[1].progress);
      }, 700)
    );
    stageTimers.current.push(
      setTimeout(() => {
        setStageIndex(2);
        setProgress(stages[2].progress);
      }, 2000)
    );
    // Gentle progress bump every 250ms so the bar feels alive up to ~95%.
    progressInterval.current = setInterval(() => {
      setProgress((p) => (p >= 95 ? p : Math.min(95, p + 1)));
    }, 250);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      formData.append("category", category.trim());

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data as any)?.error || "Failed to upload document"
        );
      }

      const doc = (data as any)?.document;
      const contentLength: number | undefined = doc?.contentLength;
      const chunkCount: number | undefined = doc?.chunkCount;

      // Complete the progress bar before closing.
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      setProgress(100);

      toast.success("Document uploaded", {
        description: `Extracted ${
          typeof contentLength === "number"
            ? contentLength.toLocaleString()
            : "—"
        } characters, ${chunkCount ?? 0} chunks`,
      });

      const newId: string | undefined = doc?.id;
      onOpenChange(false);
      onListRefresh();
      if (newId) onUploaded(newId);
    } catch (e: any) {
      // Cancel scheduled stages
      stageTimers.current.forEach(clearTimeout);
      stageTimers.current = [];
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      setProgress(0);
      setStageIndex(0);
      setError(e?.message || "Could not upload document");
    } finally {
      setUploading(false);
    }
  }

  const kind = file ? getFileKind(file) : "unknown";
  const stageExt =
    kind === "pdf" ? "pdf" : kind === "docx" ? "docx" : "txt";
  const stageLabel = buildUploadStages(stageExt)[
    Math.min(stageIndex, 2)
  ]?.label;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (uploading) return; // don't allow closing mid-upload
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-5 text-primary" />
            Upload File
          </DialogTitle>
          <DialogDescription>
            Drop a PDF, DOCX, or TXT file — we&apos;ll extract the text and
            split it into searchable chunks automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Drop zone / file preview */}
          {!file ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={handleBrowseClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleBrowseClick();
                }
              }}
              className={cn(
                "relative flex flex-col items-center justify-center text-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/[0.03]",
                uploading && "pointer-events-none opacity-60"
              )}
            >
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Upload className="size-5" />
              </div>
              <p className="text-sm font-medium">
                Drag &amp; drop a file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Maximum 10MB. Supported: PDF, DOCX, TXT.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT_ATTR}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-start gap-3">
                <FileKindIcon kind={kind} className="size-10 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium truncate" title={file.name}>
                      {file.name}
                    </p>
                    {!uploading && (
                      <button
                        onClick={clearSelectedFile}
                        className="text-muted-foreground hover:text-foreground rounded p-0.5 -mt-0.5"
                        aria-label="Remove file"
                        title="Remove file"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1 font-medium uppercase",
                        kind === "pdf" &&
                          "border-red-300/70 bg-red-500/5 text-red-600 dark:border-red-900/60 dark:text-red-400",
                        kind === "docx" &&
                          "border-blue-300/70 bg-blue-500/5 text-blue-600 dark:border-blue-900/60 dark:text-blue-400",
                        kind === "txt" &&
                          "border-muted bg-muted/40 text-muted-foreground"
                      )}
                    >
                      {kind}
                    </Badge>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Accepted file types as badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Accepts:</span>
            {[
              { ext: "PDF", cls: "border-red-300/60 bg-red-500/5 text-red-600 dark:text-red-400" },
              { ext: "DOCX", cls: "border-blue-300/60 bg-blue-500/5 text-blue-600 dark:text-blue-400" },
              { ext: "TXT", cls: "border-muted bg-muted/40 text-muted-foreground" },
            ].map((t) => (
              <Badge
                key={t.ext}
                variant="outline"
                className={cn("gap-1 text-[10px] font-medium", t.cls)}
              >
                <FileText className="size-2.5" />
                {t.ext}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground ml-auto">
              Max 10MB
            </span>
          </div>

          {/* Title */}
          <div className="grid gap-1.5">
            <Label htmlFor="upload-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="upload-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-filled from file name — edit if needed"
              disabled={uploading}
            />
          </div>

          {/* Category */}
          <div className="grid gap-1.5">
            <Label htmlFor="upload-category">
              Category <span className="text-destructive">*</span>
            </Label>
            <Input
              id="upload-category"
              list="upload-category-options"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="General"
              disabled={uploading}
            />
            <datalist id="upload-category-options">
              {CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Type or pick a suggested category.
            </p>
          </div>

          {/* Progress */}
          {uploading && (
            <div className="space-y-2 rounded-lg border bg-primary/[0.03] border-primary/20 p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 text-primary font-medium">
                  <Loader2 className="size-3.5 animate-spin" />
                  {stageLabel}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <Info className="size-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="gap-2"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {uploading ? "Processing…" : "Upload & Process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DocumentsView;
