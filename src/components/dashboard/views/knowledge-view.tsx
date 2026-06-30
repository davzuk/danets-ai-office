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
import { Skeleton } from "@/components/ui/skeleton";
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

/** A single matched KB article returned by /api/knowledge-base/test-search. */
interface TestSearchMatch {
  rank: number;
  id: string;
  title: string;
  category: string;
  contentPreview: string;
}

/** Full response from the KB test-search endpoint. */
interface TestSearchResults {
  query: string;
  totalActiveKb: number;
  matchedCount: number;
  matches: TestSearchMatch[];
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

function CategoryBadge({
  category,
  onClick,
  active,
}: {
  category: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const color = getCategoryColor(category);
  const classes = cn(
    "gap-1 font-medium border transition-opacity",
    active ? color.filled : color.soft,
    onClick && "cursor-pointer hover:opacity-80"
  );
  const inner = (
    <>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-white/80" : color.dot
        )}
      />
      {category}
    </>
  );
  if (onClick) {
    return (
      <Badge asChild variant="outline" className={classes}>
        <button
          type="button"
          onClick={onClick}
          aria-label={`Filter by ${category}`}
          aria-pressed={active}
        >
          {inner}
        </button>
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={classes}>
      {inner}
    </Badge>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
  category,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  category?: string;
}) {
  const color = category ? getCategoryColor(category) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Filter by ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors shrink-0",
        active
          ? color
            ? color.filled
            : "bg-primary text-primary-foreground border-primary"
          : color
          ? cn("bg-background", color.outline)
          : "bg-background border-border text-foreground hover:bg-muted/50"
      )}
    >
      {color && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            active ? "bg-white/80" : color.dot
          )}
        />
      )}
      <span>{label}</span>
      <span
        className={cn(
          "ml-0.5 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums leading-4 min-w-[1.25rem]",
          active ? "bg-white/25 text-current" : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
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

/** Example visitor queries shown as clickable chips in the Test Search dialog. */
const EXAMPLE_TEST_QUERIES: string[] = [
  "What are your pricing plans?",
  "Do you offer cybersecurity services?",
  "How can I contact support?",
  "What services do you provide?",
];

/**
 * Category color system.
 *
 * Common categories are mapped explicitly. Unknown categories are hashed to
 * one of the palette keys for deterministic per-category coloring. Both the
 * filter chips and the card badges read from this map so colors stay
 * consistent across the UI. No raw indigo/blue — uses project brand tokens
 * (`primary` / `accent`) plus Tailwind emerald/amber/violet/rose/cyan/orange.
 */
interface CategoryColorClasses {
  /** Small solid dot shown inside chips/badges. */
  dot: string;
  /** Filled background — active chips + active card badges. */
  filled: string;
  /** Soft tinted background — default card badges. */
  soft: string;
  /** Outline style — inactive chips. */
  outline: string;
}

const CATEGORY_PALETTE: Record<string, CategoryColorClasses> = {
  emerald: {
    dot: "bg-emerald-500",
    filled: "bg-emerald-500 text-white border-emerald-600",
    soft: "bg-emerald-50 text-emerald-700 border-emerald-200",
    outline: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
  },
  primary: {
    dot: "bg-primary",
    filled: "bg-primary text-primary-foreground border-primary",
    soft: "bg-primary/10 text-primary border-primary/25",
    outline: "border-primary/30 text-primary hover:bg-primary/10",
  },
  accent: {
    dot: "bg-accent",
    filled: "bg-accent text-accent-foreground border-accent",
    soft: "bg-accent/25 text-accent-foreground border-accent/40",
    outline: "border-accent/50 text-accent-foreground hover:bg-accent/20",
  },
  amber: {
    dot: "bg-amber-500",
    filled: "bg-amber-500 text-white border-amber-600",
    soft: "bg-amber-50 text-amber-700 border-amber-200",
    outline: "border-amber-300 text-amber-700 hover:bg-amber-50",
  },
  violet: {
    dot: "bg-violet-500",
    filled: "bg-violet-500 text-white border-violet-600",
    soft: "bg-violet-50 text-violet-700 border-violet-200",
    outline: "border-violet-300 text-violet-700 hover:bg-violet-50",
  },
  rose: {
    dot: "bg-rose-500",
    filled: "bg-rose-500 text-white border-rose-600",
    soft: "bg-rose-50 text-rose-700 border-rose-200",
    outline: "border-rose-300 text-rose-700 hover:bg-rose-50",
  },
  cyan: {
    dot: "bg-cyan-500",
    filled: "bg-cyan-500 text-white border-cyan-600",
    soft: "bg-cyan-50 text-cyan-700 border-cyan-200",
    outline: "border-cyan-300 text-cyan-700 hover:bg-cyan-50",
  },
  orange: {
    dot: "bg-orange-500",
    filled: "bg-orange-500 text-white border-orange-600",
    soft: "bg-orange-50 text-orange-700 border-orange-200",
    outline: "border-orange-300 text-orange-700 hover:bg-orange-50",
  },
};

const CATEGORY_HASH_KEYS = [
  "emerald",
  "primary",
  "accent",
  "amber",
  "violet",
  "rose",
  "cyan",
  "orange",
] as const;

const CATEGORY_NAME_MAP: Record<string, keyof typeof CATEGORY_PALETTE> = {
  about: "emerald",
  services: "primary",
  service: "primary",
  support: "accent",
  pricing: "amber",
  faq: "violet",
  faqs: "violet",
  imported: "rose",
};

function hashCategoryToKey(category: string): keyof typeof CATEGORY_PALETTE {
  let hash = 0;
  const str = category.toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return CATEGORY_HASH_KEYS[Math.abs(hash) % CATEGORY_HASH_KEYS.length];
}

function getCategoryColorKey(
  category: string
): keyof typeof CATEGORY_PALETTE {
  const key = category.trim().toLowerCase();
  return CATEGORY_NAME_MAP[key] ?? hashCategoryToKey(category);
}

function getCategoryColor(category: string): CategoryColorClasses {
  return CATEGORY_PALETTE[getCategoryColorKey(category)];
}

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

  // Test search dialog state
  const [testSearchOpen, setTestSearchOpen] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [testSearching, setTestSearching] = useState(false);
  const [testResults, setTestResults] = useState<TestSearchResults | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const testSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testSearchAbort = useRef<AbortController | null>(null);

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

  // Per-category total counts (from stats; falls back to current items list
  // before stats load). Used by the filter chips so counts stay stable even
  // while other filters (search / status) narrow the visible list.
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    if (stats?.byCategory && stats.byCategory.length > 0) {
      stats.byCategory.forEach((c) => {
        map[c.category] = c.count;
      });
    } else {
      items.forEach((i) => {
        map[i.category] = (map[i.category] ?? 0) + 1;
      });
    }
    return map;
  }, [stats, items]);

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

  /** Run a KB test search against the TF-IDF retrieval system. Aborts any
   * in-flight request so the latest query wins. Errors are toasted (per spec)
   * and also surfaced inline in the dialog. */
  const runTestSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query) return;
    testSearchAbort.current?.abort();
    const ac = new AbortController();
    testSearchAbort.current = ac;
    setTestSearching(true);
    setTestError(null);
    try {
      const res = await fetch("/api/knowledge-base/test-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Search failed");
      }
      setTestResults(data as TestSearchResults);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      const msg = e?.message || "Could not run search";
      setTestError(msg);
      toast.error(msg);
    } finally {
      if (!ac.signal.aborted) setTestSearching(false);
    }
  }, []);

  // Debounced auto-search — fires 400ms after typing stops. Clears immediately
  // when the input is emptied, and is bypassed by manual submit / chip clicks.
  useEffect(() => {
    if (!testSearchOpen) return;
    const query = testQuery.trim();
    if (testSearchTimer.current) {
      clearTimeout(testSearchTimer.current);
      testSearchTimer.current = null;
    }
    if (!query) {
      setTestResults(null);
      setTestError(null);
      setTestSearching(false);
      return;
    }
    setTestSearching(true);
    testSearchTimer.current = setTimeout(() => {
      testSearchTimer.current = null;
      runTestSearch(query);
    }, 400);
    return () => {
      if (testSearchTimer.current) {
        clearTimeout(testSearchTimer.current);
        testSearchTimer.current = null;
      }
    };
  }, [testQuery, testSearchOpen, runTestSearch]);

  /** Manual submit (Search button / Enter) — cancels any pending debounce and
   * fires the request immediately so the user gets instant feedback. */
  function handleTestSearchSubmit() {
    if (testSearchTimer.current) {
      clearTimeout(testSearchTimer.current);
      testSearchTimer.current = null;
    }
    runTestSearch(testQuery);
  }

  // Reset test-search state when the dialog closes so reopening starts clean.
  useEffect(() => {
    if (!testSearchOpen) {
      if (testSearchTimer.current) {
        clearTimeout(testSearchTimer.current);
        testSearchTimer.current = null;
      }
      testSearchAbort.current?.abort();
      setTestQuery("");
      setTestResults(null);
      setTestError(null);
      setTestSearching(false);
    }
  }, [testSearchOpen]);

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
          <Button
            variant="outline"
            onClick={() => setTestSearchOpen(true)}
            className="gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
            title="Test how the AI retrieves KB articles for a visitor query"
          >
            <Search className="size-4" />
            Test Search
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
          </div>
          {/* Category filter chips — horizontal scroll on overflow */}
          <div
            className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scroll-thin -mx-1 px-1"
            role="group"
            aria-label="Filter by category"
          >
            <CategoryChip
              label="All"
              count={stats?.total ?? items.length}
              active={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            />
            {categoryOptions.map((cat) => (
              <CategoryChip
                key={cat}
                label={cat}
                category={cat}
                count={categoryCounts[cat] ?? 0}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
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
              onFilterCategory={setCategoryFilter}
              activeCategory={categoryFilter !== "all" ? categoryFilter : undefined}
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

      {/* Test Search dialog — preview which KB articles the AI would match */}
      <Dialog
        open={testSearchOpen}
        onOpenChange={(o) => setTestSearchOpen(o)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Search className="size-4" />
              </span>
              Test KB Search
            </DialogTitle>
            <DialogDescription>
              Type a question your visitors might ask. See which knowledge base
              articles the AI would use to answer.
            </DialogDescription>
          </DialogHeader>

          {/* Search input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTestSearchSubmit();
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="e.g. What are your pricing plans?"
                className="pl-9 pr-9"
                aria-label="Test search query"
                autoFocus
              />
              {testSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground pointer-events-none" />
              )}
            </div>
            <Button
              type="submit"
              disabled={testSearching || !testQuery.trim()}
              className="gap-2"
            >
              <Search className="size-4" />
              Search
            </Button>
          </form>

          {/* Example query chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Try:</span>
            {EXAMPLE_TEST_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setTestQuery(q);
                  runTestSearch(q);
                }}
                className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Results area */}
          <div className="flex-1 overflow-y-auto scroll-thin -mx-1 px-1 min-h-[220px]">
            {testError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
                <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Search className="size-5 text-destructive" />
                </div>
                <p className="text-sm font-medium text-destructive">
                  Search failed
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  {testError}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => runTestSearch(testQuery)}
                  disabled={testSearching || !testQuery.trim()}
                >
                  Try again
                </Button>
              </div>
            ) : testSearching && !testResults ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            ) : testResults ? (
              <div className="space-y-3">
                {testSearching && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Updating…
                  </div>
                )}
                {testResults.matchedCount === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
                    <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                      <Search className="size-5 text-amber-600" />
                    </div>
                    <p className="text-sm font-medium text-amber-900">
                      No matches found
                    </p>
                    <p className="text-xs text-amber-700 mt-1 max-w-sm mx-auto">
                      Consider adding a KB article for this topic so the AI can
                      answer similar visitor questions.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Found{" "}
                      <span className="font-semibold text-foreground">
                        {testResults.matchedCount}
                      </span>{" "}
                      {testResults.matchedCount === 1 ? "match" : "matches"}{" "}
                      out of{" "}
                      <span className="font-semibold text-foreground">
                        {testResults.totalActiveKb}
                      </span>{" "}
                      active{" "}
                      {testResults.totalActiveKb === 1 ? "article" : "articles"}
                    </div>
                    {testResults.matches.map((m) => (
                      <TestSearchResultCard key={m.id} match={m} />
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-10">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Search className="size-5 text-primary" />
                </div>
                <p className="text-sm font-medium">
                  Search to see matching articles
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Results use the same TF-IDF retrieval the AI applies to real
                  visitor chats — only active articles are matched.
                </p>
              </div>
            )}
          </div>
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
  onFilterCategory,
  activeCategory,
}: {
  item: KbItem;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onFilterCategory: (category: string) => void;
  activeCategory?: string;
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
              <CategoryBadge
                category={item.category}
                onClick={() => onFilterCategory(item.category)}
                active={activeCategory === item.category}
              />
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

function TestSearchResultCard({ match }: { match: TestSearchMatch }) {
  // Rank-based relevance: #1 = 100%, #2 = 80%, #3 = 60%, #4 = 40%, #5 = 20%.
  // Ranks beyond 5 (backend caps at 5) floor at 20%.
  const relevance = Math.max(20, 100 - (match.rank - 1) * 20);
  const barColor =
    relevance >= 80
      ? "bg-emerald-500"
      : relevance >= 60
      ? "bg-primary"
      : relevance >= 40
      ? "bg-amber-500"
      : "bg-rose-500";
  const color = getCategoryColor(match.category);
  return (
    <Card className="py-0 transition-shadow hover:shadow-md hover:border-primary/30">
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold tabular-nums">
            #{match.rank}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <h4 className="font-semibold text-sm leading-snug line-clamp-1">
                {match.title}
              </h4>
              <Badge
                variant="outline"
                className={cn("gap-1 font-medium border", color.soft)}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", color.dot)} />
                {match.category}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-3">
              {match.contentPreview}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Relevance
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", barColor)}
                  style={{ width: `${relevance}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums w-9 text-right">
                {relevance}%
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default KnowledgeView;
