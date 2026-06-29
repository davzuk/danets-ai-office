"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Trash2,
  Power,
  FileText,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Archive,
  Eye,
  ExternalLink,
  Link as LinkIcon,
  Upload,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface KbUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface KbItem {
  id: string;
  title: string;
  content: string;
  category: string;
  sourceType: "manual" | "faq" | "doc" | "url";
  status: "active" | "draft" | "archived";
  views: number;
  createdAt: string;
  updatedAt: string;
}

interface KbStats {
  total: number;
  active: number;
  draft: number;
  archived: number;
  byCategory: { category: string; count: number }[];
  bySource: { sourceType: string; count: number }[];
}

const SOURCE_TYPE_OPTIONS: {
  value: KbItem["sourceType"];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "manual", label: "Manual", icon: FileText },
  { value: "faq", label: "FAQ", icon: HelpCircleIcon },
  { value: "doc", label: "Document", icon: FileText },
  { value: "url", label: "URL", icon: LinkIcon },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
] as const;

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
] as const;

function HelpCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function StatusBadge({ status }: { status: KbItem["status"] }) {
  if (status === "active") {
    return (
      <Badge className="bg-accent text-accent-foreground hover:bg-accent/90 border-transparent gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-foreground/70" />
        Active
      </Badge>
    );
  }
  if (status === "draft") {
    return (
      <Badge variant="secondary" className="gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        Draft
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <Archive className="size-3" />
      Archived
    </Badge>
  );
}

function SourceBadge({ sourceType }: { sourceType: KbItem["sourceType"] }) {
  const opt = SOURCE_TYPE_OPTIONS.find((o) => o.value === sourceType);
  const Icon = opt?.icon || FileText;
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground font-normal">
      <Icon className="size-3" />
      {opt?.label || sourceType}
    </Badge>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge
      variant="outline"
      className="border-primary/20 bg-primary/5 text-primary font-medium"
    >
      {category}
    </Badge>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function relativeTime(iso: string) {
  try {
    const d = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - d);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  } catch {
    return formatDate(iso);
  }
}

function truncate(text: string, max = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + "…";
}

interface FormState {
  title: string;
  content: string;
  category: string;
  sourceType: KbItem["sourceType"];
  status: KbItem["status"];
}

const EMPTY_FORM: FormState = {
  title: "",
  content: "",
  category: "General",
  sourceType: "manual",
  status: "active",
};

type ImportFormat = "auto" | "colon" | "blocks" | "json";

const IMPORT_HELP: Record<ImportFormat, string> = {
  auto: "We'll detect the format automatically — JSON array first, then blank-line-separated blocks, then 'Title: content' lines.",
  colon: "One item per line, 'Title: content' separated by the first colon.",
  blocks:
    "First line is the title, following lines are content, separated by blank lines.",
  json: 'A JSON array of objects: [{"title":"...","content":"...","category":"..."}]. Category is optional.',
};

const IMPORT_PLACEHOLDERS: Record<ImportFormat, string> = {
  auto: "Paste content here…",
  colon:
    "Refund Policy: We offer 30-day refunds on all plans.\nSupport Hours: Mon–Fri, 9am–6pm.",
  blocks:
    "Refund Policy\nWe offer 30-day refunds on all plans.\n\nSupport Hours\nMon–Fri, 9am–6pm.",
  json: '[\n  {"title":"Refund Policy","content":"We offer 30-day refunds on all plans."},\n  {"title":"Support Hours","content":"Mon–Fri, 9am–6pm.","category":"Support"}\n]',
};

const IMPORT_EXAMPLES: Record<ImportFormat, string> = {
  auto: "Any of the formats below — we'll pick the right one.",
  colon: "Refund Policy: We offer 30-day refunds on all plans.",
  blocks:
    "Refund Policy\nWe offer 30-day refunds on all plans.\n\nSupport Hours\nMon–Fri, 9am–6pm.",
  json: '[{"title":"...","content":"...","category":"..."}]',
};

export function KnowledgeView({ user: _user }: { user: KbUser }) {
  const [items, setItems] = useState<KbItem[]>([]);
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Toolbar state
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<KbItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Preview dialog
  const [previewItem, setPreviewItem] = useState<KbItem | null>(null);

  // Bulk import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>("auto");
  const [importCategory, setImportCategory] = useState("Imported");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const fetchInFlight = useRef(false);

  // Debounced search (300ms)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base/stats", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load stats");
      const data = await res.json();
      setStats(data);
    } catch {
      // Silent — stats are best-effort
    }
  }, []);

  const loadItems = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (fetchInFlight.current) return;
      fetchInFlight.current = true;
      if (!opts?.silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (categoryFilter !== "all") params.set("category", categoryFilter);
        if (statusFilter !== "all") params.set("status", statusFilter);
        const url = `/api/knowledge-base${params.toString() ? `?${params}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load knowledge base");
        const data = await res.json();
        setItems(data.items || []);
      } catch (e: any) {
        toast.error(e?.message || "Could not load knowledge base");
      } finally {
        setLoading(false);
        fetchInFlight.current = false;
      }
    },
    [debouncedSearch, categoryFilter, statusFilter]
  );

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Derived: unique categories from items (for the toolbar filter)
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category));
    if (stats?.byCategory) {
      stats.byCategory.forEach((c) => set.add(c.category));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items, stats]);

  // All known categories for the create/edit datalist
  const allCategories = useMemo(() => {
    const set = new Set<string>(["General"]);
    categoryOptions.forEach((c) => set.add(c));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categoryOptions]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(item: KbItem) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      content: item.content,
      category: item.category,
      sourceType: item.sourceType,
      status: item.status,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim() || form.title.trim().length < 2) {
      toast.error("Title must be at least 2 characters");
      return;
    }
    if (!form.content.trim()) {
      toast.error("Content is required");
      return;
    }
    if (!form.category.trim()) {
      toast.error("Category is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content,
        category: form.category.trim(),
        sourceType: form.sourceType,
        status: form.status,
      };
      const isEdit = !!editingId;
      const url = isEdit
        ? `/api/knowledge-base/${editingId}`
        : "/api/knowledge-base";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Save failed");
      }
      toast.success(isEdit ? "Item updated" : "Item created", {
        description: payload.title,
      });
      setDialogOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await Promise.all([loadItems({ silent: true }), loadStats()]);
    } catch (e: any) {
      toast.error(e?.message || "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(item: KbItem) {
    const next = item.status === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/api/knowledge-base/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Update failed");
      toast.success(`Marked as ${next}`, { description: item.title });
      await Promise.all([loadItems({ silent: true }), loadStats()]);
    } catch (e: any) {
      toast.error(e?.message || "Could not update status");
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/knowledge-base/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toast.success("Item deleted", { description: deleteTarget.title });
      setDeleteTarget(null);
      await Promise.all([loadItems({ silent: true }), loadStats()]);
    } catch (e: any) {
      toast.error(e?.message || "Could not delete item");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadItems({ silent: true }), loadStats()]);
    setRefreshing(false);
    toast.success("Refreshed");
  }

  function openImport() {
    setImportFormat("auto");
    setImportCategory("Imported");
    setImportText("");
    setImportDialogOpen(true);
  }

  async function handleImport() {
    if (!importText.trim()) {
      toast.error("Paste some content to import");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/knowledge-base/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: importFormat,
          category: importCategory.trim() || "Imported",
          text: importText,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Import failed");
      }
      const imported: number = Number(data?.imported ?? 0);
      const skipped: number = Number(data?.skipped ?? 0);
      toast.success(
        `Imported ${imported} item${imported === 1 ? "" : "s"}`,
        {
          description:
            skipped > 0
              ? `${skipped} skipped · knowledge base updated.`
              : "Your knowledge base has been updated.",
        }
      );
      setImportDialogOpen(false);
      setImportText("");
      await Promise.all([loadItems({ silent: true }), loadStats()]);
    } catch (e: any) {
      toast.error(e?.message || "Could not import items");
    } finally {
      setImporting(false);
    }
  }

  const visibleCount = items.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Knowledge Base</h1>
              <p className="text-sm text-muted-foreground">
                Articles, FAQs, and reference docs your AI agent uses to answer
                visitors.
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
            onClick={openImport}
            className="gap-2"
          >
            <Upload className="size-4" />
            Import
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="size-4" />
            New item
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total"
          value={stats?.total ?? 0}
          icon={<BookOpen className="size-4" />}
          tone="primary"
        />
        <StatCard
          label="Active"
          value={stats?.active ?? 0}
          icon={<CheckCircle2 className="size-4" />}
          tone="accent"
        />
        <StatCard
          label="Drafts"
          value={stats?.draft ?? 0}
          icon={<FileText className="size-4" />}
          tone="muted"
        />
        <StatCard
          label="Archived"
          value={stats?.archived ?? 0}
          icon={<Archive className="size-4" />}
          tone="muted"
        />
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
                className="pl-9"
                aria-label="Search knowledge base"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1.5 py-0.5 rounded"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={categoryFilter}
                onValueChange={setCategoryFilter}
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Category" />
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
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Tabs
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="w-fit"
            >
              <TabsList>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <TabsTrigger key={s.value} value={s.value}>
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {(debouncedSearch ||
              categoryFilter !== "all" ||
              statusFilter !== "all") && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {visibleCount} {visibleCount === 1 ? "item" : "items"} match
                </span>
                <button
                  onClick={() => {
                    setSearchInput("");
                    setDebouncedSearch("");
                    setCategoryFilter("all");
                    setStatusFilter("all");
                  }}
                  className="text-primary hover:underline"
                >
                  Reset filters
                </button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" />
          Loading knowledge base…
        </div>
      ) : items.length === 0 ? (
        <EmptyState onCreate={openCreate} hasFilters={!!debouncedSearch || categoryFilter !== "all" || statusFilter !== "all"} />
      ) : (
        <div className="max-h-[70vh] overflow-y-auto scroll-thin pr-1 -mr-1 space-y-3">
          {items.map((item) => (
            <KbCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onToggle={() => handleToggleStatus(item)}
              onDelete={() => setDeleteTarget(item)}
              onPreview={() => setPreviewItem(item)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setEditingId(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit knowledge item" : "New knowledge item"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this article. Changes are picked up by the AI agent on the next chat."
                : "Add a new article the AI agent can use to answer visitor questions."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="kb-title">Title</Label>
              <Input
                id="kb-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. Refund policy"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="kb-category">Category</Label>
                <Input
                  id="kb-category"
                  list="kb-category-options"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  placeholder="General"
                />
                <datalist id="kb-category-options">
                  {allCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Type or pick an existing category.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Source type</Label>
                <Select
                  value={form.sourceType}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      sourceType: v as KbItem["sourceType"],
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="kb-content">Content</Label>
              <Textarea
                id="kb-content"
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
                rows={6}
                className="min-h-[140px] resize-y font-mono text-[13px] leading-relaxed"
                placeholder="Write the article body. Markdown-style plain text works well."
              />
              <p className="text-xs text-muted-foreground">
                {form.content.length} characters · be specific and factual.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, status: v as KbItem["status"] }))
                }
              >
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only <span className="font-medium">Active</span> items are used
                by the AI agent.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingId ? "Save changes" : "Create item"}
            </Button>
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
            <AlertDialogTitle>Delete this knowledge item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.title}
              </span>
              . The AI agent will no longer be able to use this article. This
              action cannot be undone.
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
              Delete item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk import dialog */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(o) => {
          setImportDialogOpen(o);
          if (!o) setImportText("");
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk import knowledge items</DialogTitle>
            <DialogDescription>
              Paste content in one of the supported formats to create many
              items at once. Up to 50 items per import.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Format</Label>
              <Tabs
                value={importFormat}
                onValueChange={(v) =>
                  setImportFormat(v as ImportFormat)
                }
              >
                <TabsList className="flex-wrap h-auto">
                  <TabsTrigger value="auto">Auto-detect</TabsTrigger>
                  <TabsTrigger value="colon">Title: content</TabsTrigger>
                  <TabsTrigger value="blocks">Blocks</TabsTrigger>
                  <TabsTrigger value="json">JSON array</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="kb-import-category">
                Category (optional)
              </Label>
              <Input
                id="kb-import-category"
                list="kb-category-options"
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value)}
                placeholder="Imported"
              />
              <p className="text-xs text-muted-foreground">
                Applied to every imported item. JSON items can override this
                with their own <code>category</code> field.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="kb-import-text">Content</Label>
              <Textarea
                id="kb-import-text"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={10}
                className="min-h-[220px] resize-y font-mono text-[13px] leading-relaxed"
                placeholder={IMPORT_PLACEHOLDERS[importFormat]}
              />
              <p className="text-xs text-muted-foreground">
                {importText.length} characters · {IMPORT_HELP[importFormat]}
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Example: </span>
              <code className="font-mono whitespace-pre-wrap break-words">
                {IMPORT_EXAMPLES[importFormat]}
              </code>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(false)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="gap-2"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog
        open={!!previewItem}
        onOpenChange={(o) => !o && setPreviewItem(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-8">{previewItem?.title}</DialogTitle>
            <DialogDescription>
              <span className="inline-flex flex-wrap items-center gap-2 mt-1">
                {previewItem && <CategoryBadge category={previewItem.category} />}
                {previewItem && <SourceBadge sourceType={previewItem.sourceType} />}
                {previewItem && <StatusBadge status={previewItem.status} />}
              </span>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[55vh] rounded-lg border">
            <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans bg-muted/40 p-4">
              {previewItem?.content}
            </pre>
          </ScrollArea>
          <DialogFooter className="flex-row sm:justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Updated {previewItem && relativeTime(previewItem.updatedAt)} ·{" "}
              {previewItem?.views ?? 0} views
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (previewItem) openEdit(previewItem);
                  setPreviewItem(null);
                }}
              >
                Edit
              </Button>
              <Button onClick={() => setPreviewItem(null)}>Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "primary" | "accent" | "muted";
}) {
  const toneClasses =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "accent"
      ? "bg-accent/20 text-accent-foreground"
      : "bg-muted text-muted-foreground";
  return (
    <Card className="py-4">
      <CardContent className="px-4 py-0">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {label}
            </div>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
          </div>
          <div
            className={cn(
              "h-9 w-9 flex items-center justify-center rounded-lg",
              toneClasses
            )}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KbCard({
  item,
  onEdit,
  onToggle,
  onDelete,
  onPreview,
}: {
  item: KbItem;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const nextStatusLabel =
    item.status === "active" ? "Mark as draft" : "Set active";

  return (
    <Card className="group py-0 transition-shadow hover:shadow-md hover:border-primary/30">
      <CardContent className="px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <button
              onClick={onPreview}
              className="text-left group/title w-full"
            >
              <h3 className="font-semibold text-base leading-snug line-clamp-1 group-hover/title:text-primary transition-colors">
                {item.title}
              </h3>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CategoryBadge category={item.category} />
              <SourceBadge sourceType={item.sourceType} />
              <StatusBadge status={item.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
              {truncate(item.content, 120)}
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3" />
                {item.views} views
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span>Updated {relativeTime(item.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={onPreview}
              title="Preview"
            >
              <ExternalLink className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                  title="Actions"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onPreview}>
                  <Eye className="size-4" />
                  Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onToggle}>
                  <Power className="size-4" />
                  {nextStatusLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  variant="destructive"
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
          <h3 className="font-medium">No matching items</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Try adjusting your search or filters to find what you're looking
            for.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-2xl brand-gradient flex items-center justify-center mb-4 text-white shadow-sm">
          <BookOpen className="size-7" />
        </div>
        <h3 className="font-semibold text-lg">Your knowledge base is empty</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          Add your first article, FAQ, or document. The AI agent uses these to
          answer visitor questions accurately.
        </p>
        <Button onClick={onCreate} className="mt-4 gap-2">
          <Plus className="size-4" />
          Create your first item
        </Button>
      </CardContent>
    </Card>
  );
}

export default KnowledgeView;
