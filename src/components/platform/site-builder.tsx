"use client";

// Platform console → Tenant sites → Edit (Phase 2, workstreams Q + R). Super
// admins build a tenant's website on <sub>.SITES_DOMAIN: pages from blocks
// with a live preview, versions and publishing, plus the AI page builder
// (one prompt → a draft landing page from the tenant's brand, knowledge
// base, forms, booking types and lead magnets). Tenants have no builder.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  History,
  ImageIcon,
  Loader2,
  Monitor,
  Plus,
  Save,
  Smartphone,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  DEFAULT_THEME,
  MAX_BLOCKS,
  SITE_BLOCK_DEFS,
  SITE_BLOCK_KEYS,
  SITE_FONTS,
  findPlaceholders,
  newBlock,
  validateBlocks,
  type BlockField,
  type BlockIssue,
  type PageSeo,
  type Placeholder,
  type SiteBlock,
  type SiteBlockKey,
  type SiteSeoDefaults,
  type SiteTheme,
} from "@/lib/sites/blocks";
import { cn } from "@/lib/utils";

interface SitePage {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | string;
  publishedAt: string | null;
  updatedAt: string;
  views: number;
  conversions: number;
  url: string | null;
  hideFromNav: boolean;
  aiGenerated: boolean;
}

interface Resources {
  forms: { id: string; name: string }[];
  magnets: { id: string; title: string; status: string }[];
  bookingTypes: { slug: string; name: string }[];
  images: { id: string; url: string; alt: string }[];
}

interface SiteData extends Resources {
  sitesDomain: string | null;
  appOrigin: string;
  business: { id: string; name: string; publicKey: string; status: string } | null;
  moduleEnabled: boolean;
  limit: { used: number; limit: number };
  site: {
    id: string;
    subdomain: string;
    origin: string | null;
    status: string;
    theme: SiteTheme;
    seoDefaults: SiteSeoDefaults;
    widgetEnabled: boolean;
  };
  pages: SitePage[];
}

async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: init?.json !== undefined ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.error || "Something went wrong.") as Error & { data?: any };
    err.data = d;
    throw err;
  }
  return d as T;
}

const blockId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pageLabel = (slug: string) => (slug ? `/${slug}` : "/ (home)");

/** "items.1.title: Add a title" → "Items, item 2, Title: Add a title". */
function friendlyIssue(blockKey: SiteBlockKey, message: string): string {
  const at = message.indexOf(": ");
  if (at < 0) return message;
  const parts: string[] = [];
  let fields: BlockField[] | undefined = SITE_BLOCK_DEFS[blockKey].fields;
  let listItem = "Item";
  for (const seg of message.slice(0, at).split(".")) {
    if (/^\d+$/.test(seg)) {
      parts.push(`${listItem.toLowerCase()} ${Number(seg) + 1}`);
      continue;
    }
    const f: BlockField | undefined = fields?.find((x) => x.name === seg);
    if (!f) return message;
    parts.push(f.label);
    if (f.type === "list") {
      fields = f.fields;
      listItem = f.itemLabel;
    } else fields = undefined;
  }
  return `${parts.join(", ")}: ${message.slice(at + 2)}`;
}

const placeholderLabel = (p: Placeholder) => {
  const where = friendlyIssue(p.blockKey, `${p.path}: x`).replace(/: x$/, "");
  return `${SITE_BLOCK_DEFS[p.blockKey].label} → ${where}`;
};

/** Names the preview shows for linked forms and magnets. */
const previewLabels = (r: Resources) => Object.fromEntries([...r.forms.map((f) => [f.id, f.name]), ...r.magnets.map((m) => [m.id, m.title])]);

export function SiteBuilder({ siteId, onBack }: { siteId: string; onBack: () => void }) {
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const base = `/api/super-admin/sites/${siteId}`;

  const load = useCallback(async () => {
    try {
      setData(await api<SiteData>(base));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [base]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  if (editing) {
    return (
      <PageEditor
        base={base}
        pageId={editing}
        data={data}
        onBack={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} title="Back to tenant sites">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{data.business?.name ?? "Website"}</h2>
            <p className="text-sm text-muted-foreground">Website built by the platform. The tenant can&apos;t edit it.</p>
          </div>
        </div>
        {data.site.origin && (
          <div className="flex items-center gap-2">
            {data.site.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
            <Button variant="outline" size="sm" asChild>
              <a href={data.site.origin} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                {data.site.origin.replace(/^https?:\/\//, "")}
              </a>
            </Button>
          </div>
        )}
      </div>
      {!data.moduleEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The Website module is off for this tenant (plan below Starter, or the <code>sites_builder</code> feature flag is off), so published pages show &ldquo;not found&rdquo;. Turn it on under Tenants → the business → Feature flags.</span>
        </div>
      )}
      <PagesCard base={base} data={data} onChange={load} onEdit={setEditing} />
      <SettingsCard base={base} data={data} onSaved={load} />
    </div>
  );
}

// ─── Pages ──────────────────────────────────────────────────────────

function PagesCard({ base, data, onChange, onEdit }: { base: string; data: SiteData; onChange: () => void; onEdit: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<SitePage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { used, limit } = data.limit;

  const act = async (p: SitePage, action: "publish" | "unpublish") => {
    setBusy(p.id);
    try {
      await api(`${base}/pages/${p.id}`, { method: "POST", json: { action } });
      toast.success(action === "publish" ? "Page published." : "Page taken offline. The draft is kept.");
      onChange();
    } catch (e: any) {
      toast.error(e.data?.issues?.length ? "Some blocks need attention. Open the page to fix them." : e.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`${base}/pages/${deleting.id}`, { method: "DELETE" });
      toast.success("Page deleted.");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Pages</CardTitle>
          <CardDescription>
            {limit > 0 ? `${used} of ${limit} published pages on the tenant's plan.` : `${used} published.`} Views and leads count from each page&apos;s first visit.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New page
          </Button>
          <Button size="sm" onClick={() => setGenerating(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate with AI
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Page</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 text-right font-medium">Views</th>
                <th className="py-2 pr-3 text-right font-medium">Leads</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.pages.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <button className="text-left font-medium hover:underline" onClick={() => onEdit(p.id)}>
                      {p.title}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {pageLabel(p.slug)}
                      {p.hideFromNav && " · not in the menu"}
                      {p.aiGenerated && " · AI-built"}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant={p.status === "published" ? "default" : "secondary"}>{p.status === "published" ? "Published" : "Draft"}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.views.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.conversions.toLocaleString()}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-1">
                      {p.status === "published" && p.url && (
                        <Button variant="ghost" size="icon" asChild title="Open">
                          <a href={p.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => onEdit(p.id)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(p, p.status === "published" ? "unpublish" : "publish")}>
                        {p.status === "published" ? "Unpublish" : "Publish"}
                      </Button>
                      <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleting(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {data.pages.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No pages yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
      <NewPageDialog base={base} open={creating} onOpenChange={setCreating} hasHome={data.pages.some((p) => p.slug === "")} onCreated={(id) => onEdit(id)} />
      <GenerateDialog base={base} data={data} open={generating} onOpenChange={setGenerating} onCreated={(id) => onEdit(id)} />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The page, its draft and its published versions are removed. Links to {deleting ? pageLabel(deleting.slug) : "it"} will stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete page</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function NewPageDialog({ base, open, onOpenChange, hasHome, onCreated }: { base: string; open: boolean; onOpenChange: (o: boolean) => void; hasHome: boolean; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState<"blank" | "home">("blank");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const d = await api<{ page: { id: string } }>(`${base}/pages`, { method: "POST", json: { title, slug: slugTouched ? slug : slugify(title), template } });
      onOpenChange(false);
      setTitle("");
      setSlug("");
      setSlugTouched(false);
      onCreated(d.page.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>It starts as a draft. Nobody sees it until you publish it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="np-title">Title</Label>
            <Input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Our services" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-slug">Address</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                id="np-slug"
                value={slugTouched ? slug : slugify(title)}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                placeholder={hasHome ? "services" : "leave empty for the home page"}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Start from</Label>
            <Select value={template} onValueChange={(v) => setTemplate(v as "blank" | "home")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">A blank page</SelectItem>
                <SelectItem value="home">A full starter page</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI page builder ────────────────────────────────────────────────

type Goal = "leads" | "bookings" | "downloads";

function GenerateDialog({ base, data, open, onOpenChange, onCreated }: { base: string; data: SiteData; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [goal, setGoal] = useState<Goal>("leads");
  const [formId, setFormId] = useState("");
  const [magnetId, setMagnetId] = useState("");
  const [bookingType, setBookingType] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);

  const missing =
    goal === "leads" && !formId
      ? data.forms.length
        ? "Choose the form that captures leads."
        : "The tenant has no active forms. Create one under Leads → Forms first."
      : goal === "downloads" && !magnetId
        ? data.magnets.length
          ? "Choose the lead magnet to offer."
          : "The tenant has no lead magnets. Create one under Leads → Lead magnets first."
        : null;

  const run = async () => {
    setBusy(true);
    try {
      const d = await api<{ page: { id: string; placeholders: Placeholder[] } }>(`${base}/pages/generate`, {
        method: "POST",
        json: {
          prompt,
          goal,
          audience: audience || undefined,
          offer: offer || undefined,
          formId: goal === "leads" ? formId : undefined,
          magnetId: goal === "downloads" ? magnetId : undefined,
          bookingTypeSlug: goal === "bookings" && bookingType ? bookingType : undefined,
        },
      });
      const n = d.page.placeholders.length;
      toast.success(n ? `Draft ready. Fill in ${n === 1 ? "1 placeholder" : `${n} placeholders`} before publishing.` : "Draft ready. Review it before publishing.");
      onOpenChange(false);
      setPrompt("");
      onCreated(d.page.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate a landing page</DialogTitle>
          <DialogDescription>
            Built from {data.business?.name ?? "the tenant"}&apos;s brand voice, knowledge base and profile. Facts the AI can&apos;t back up are left as [Add …] placeholders. It runs on the platform&apos;s AI, not the tenant&apos;s quota.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gen-prompt">What is the page for?</Label>
            <Textarea id="gen-prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} placeholder="A page for homeowners searching for emergency roof repairs, pushing a free inspection." />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Goal</Label>
              <Select value={goal} onValueChange={(v) => setGoal(v as Goal)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leads">Capture leads with a form</SelectItem>
                  <SelectItem value="bookings">Get bookings</SelectItem>
                  <SelectItem value="downloads">Offer a lead magnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {goal === "leads" && (
              <div className="space-y-1.5">
                <Label>Form</Label>
                <Select value={formId || undefined} onValueChange={setFormId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a form" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.forms.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {goal === "downloads" && (
              <div className="space-y-1.5">
                <Label>Lead magnet</Label>
                <Select value={magnetId || undefined} onValueChange={setMagnetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a lead magnet" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.magnets.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                        {m.status !== "published" ? " (draft)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {goal === "bookings" && (
              <div className="space-y-1.5">
                <Label>Booking type</Label>
                <Select value={bookingType || "__all"} onValueChange={(v) => setBookingType(v === "__all" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Let visitors choose</SelectItem>
                    {data.bookingTypes.map((b) => (
                      <SelectItem key={b.slug} value={b.slug}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gen-aud">Audience (optional)</Label>
              <Input id="gen-aud" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} placeholder="Homeowners in Leeds" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gen-offer">Offer (optional)</Label>
              <Input id="gen-offer" value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={300} placeholder="Free inspection this month" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Only put a real, confirmed offer here: the AI treats it as a fact.</p>
          {missing && <p className="text-sm text-amber-600">{missing}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || prompt.trim().length < 10 || !!missing}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {busy ? "Building…" : "Generate draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settings ───────────────────────────────────────────────────────

/** An image from the tenant's media library, or a URL. */
function ImageInput({ value, onChange, images, id }: { value: string; onChange: (v: string) => void; images: Resources["images"]; id?: string }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <img src={value} alt="" className="h-9 w-9 shrink-0 rounded border object-cover" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or choose from the tenant's library" />
      <Button type="button" variant="outline" size="icon" title="Choose from the tenant's media library" onClick={() => setPicking(true)}>
        <ImageIcon className="h-4 w-4" />
      </Button>
      {value && (
        <Button type="button" variant="ghost" size="icon" title="Remove" onClick={() => onChange("")}>
          <X className="h-4 w-4" />
        </Button>
      )}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose an image</DialogTitle>
            <DialogDescription>From the tenant&apos;s media library (newest 60).</DialogDescription>
          </DialogHeader>
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">The tenant has no images yet. Paste a URL instead.</p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className={cn("overflow-hidden rounded-md border hover:ring-2 hover:ring-primary", img.url === value && "ring-2 ring-primary")}
                  onClick={() => {
                    onChange(img.url);
                    setPicking(false);
                  }}
                  title={img.alt}
                >
                  <img src={img.url} alt={img.alt} className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-transparent" aria-label={label} />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className={cn("w-32 font-mono", value && !valid && "border-destructive")} />
      </div>
    </div>
  );
}

function SettingsCard({ base, data, onSaved }: { base: string; data: SiteData; onSaved: () => void }) {
  const site = data.site;
  const [subdomain, setSubdomain] = useState(site.subdomain);
  const [theme, setTheme] = useState<SiteTheme>({ ...DEFAULT_THEME, ...site.theme });
  const [seo, setSeo] = useState<SiteSeoDefaults>(site.seoDefaults);
  const [widget, setWidget] = useState(site.widgetEnabled);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined));
      await api(base, {
        method: "PATCH",
        json: { ...(subdomain !== site.subdomain ? { subdomain } : {}), theme: clean(theme), seoDefaults: clean(seo), widgetEnabled: widget },
      });
      toast.success("Website settings saved.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Look and settings</CardTitle>
        <CardDescription>Apply to every page.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="site-sub">Address</Label>
          <div className="flex max-w-xl items-center gap-2">
            <Input id="site-sub" value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase())} />
            <span className="shrink-0 text-sm text-muted-foreground">.{data.sitesDomain}</span>
          </div>
          {subdomain !== site.subdomain && <p className="text-xs text-amber-600">Links to the old address will stop working.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput label="Main colour" value={theme.primaryColor ?? ""} onChange={(v) => setTheme({ ...theme, primaryColor: v })} />
          <ColorInput label="Accent colour" value={theme.accentColor ?? ""} onChange={(v) => setTheme({ ...theme, accentColor: v })} />
          <div className="space-y-1.5">
            <Label>Font</Label>
            <Select value={theme.font ?? "system"} onValueChange={(v) => setTheme({ ...theme, font: v as SiteTheme["font"] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SITE_FONTS).map(([k, f]) => (
                  <SelectItem key={k} value={k}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="max-w-xl space-y-1.5">
          <Label htmlFor="site-logo">Logo</Label>
          <ImageInput id="site-logo" images={data.images} value={theme.logoUrl ?? ""} onChange={(v) => setTheme({ ...theme, logoUrl: v })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seo-suffix">Added to every page title</Label>
            <Input id="seo-suffix" value={seo.titleSuffix ?? ""} onChange={(e) => setSeo({ ...seo, titleSuffix: e.target.value })} placeholder={`| ${data.business?.name ?? ""}`} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seo-og">Default sharing image</Label>
            <ImageInput id="seo-og" images={data.images} value={seo.ogImageUrl ?? ""} onChange={(v) => setSeo({ ...seo, ogImageUrl: v })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="seo-desc">Default search description</Label>
            <Textarea id="seo-desc" rows={2} value={seo.description ?? ""} onChange={(e) => setSeo({ ...seo, description: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Chat widget on every page</p>
            <p className="text-xs text-muted-foreground">Visitors can chat with the tenant&apos;s AI assistant, using their widget settings.</p>
          </div>
          <Switch checked={widget} onCheckedChange={setWidget} />
        </div>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Page editor ────────────────────────────────────────────────────

interface PageDraft {
  id: string;
  slug: string;
  title: string;
  status: string;
  blocks: SiteBlock[];
  seo: PageSeo;
  issues: BlockIssue[];
  placeholders: Placeholder[];
  generatedFrom: string | null;
  hasUnpublishedChanges: boolean;
}

interface Version {
  id: string;
  title: string;
  publishedBy: string | null;
  restoredFrom: string | null;
  createdAt: string;
  blockCount: number;
  live: boolean;
}

type RewriteAction = "regenerate" | "shorter" | "persuasive" | "custom";

function PageEditor({ base, pageId, data, onBack }: { base: string; pageId: string; data: SiteData; onBack: () => void }) {
  const [page, setPage] = useState<PageDraft | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [blocks, setBlocks] = useState<SiteBlock[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [seo, setSeo] = useState<PageSeo>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish">(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [customFor, setCustomFor] = useState<SiteBlock | null>(null);
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [adding, setAdding] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showSeo, setShowSeo] = useState(false);
  const [serverIssues, setServerIssues] = useState<BlockIssue[]>([]);
  const url = `${base}/pages/${pageId}`;

  const apply = useCallback((p: PageDraft) => {
    setPage(p);
    setBlocks(p.blocks);
    setTitle(p.title);
    setSlug(p.slug);
    setSeo(p.seo ?? {});
    setDirty(false);
    setServerIssues([]);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ page: PageDraft; versions: Version[] }>(url);
      apply(d.page);
      setVersions(d.versions);
    } catch (e: any) {
      toast.error(e.message);
      onBack();
    }
  }, [url, apply, onBack]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const issues = useMemo(() => validateBlocks(blocks).issues, [blocks]);
  const placeholders = useMemo(() => findPlaceholders(blocks), [blocks]);
  const issueFor = (id: string) => issues.find((i) => i.blockId === id) ?? serverIssues.find((i) => i.blockId === id);

  const change = (next: SiteBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    setBusy("save");
    try {
      const d = await api<{ page: PageDraft }>(url, { method: "PATCH", json: { title, slug, blocks, seo } });
      setPage((p) => (p ? { ...p, ...d.page } : p));
      setSlug(d.page.slug);
      setDirty(false);
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy("publish");
    try {
      await api(url, { method: "POST", json: { action: "publish" } });
      toast.success("Published. Visitors now see this version.");
      await load();
    } catch (e: any) {
      if (e.data?.issues) {
        setServerIssues(e.data.issues);
        setSelected(e.data.issues[0]?.blockId ?? null);
      } else if (e.data?.placeholders?.[0]) setSelected(e.data.placeholders[0].blockId);
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    setBusy("unpublish");
    try {
      await api(url, { method: "POST", json: { action: "unpublish" } });
      toast.success("Taken offline. The draft is kept.");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async (b: SiteBlock, action: RewriteAction, instruction?: string) => {
    setRewriting(b.id);
    try {
      const d = await api<{ block: SiteBlock }>(`${url}/rewrite`, { method: "POST", json: { action, instruction, block: b, blocks } });
      const before = blocks;
      change(blocks.map((x) => (x.id === b.id ? d.block : x)));
      setSelected(b.id);
      toast.success("Section rewritten.", { action: { label: "Undo", onClick: () => change(before) } });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRewriting(null);
    }
  };

  const back = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onBack();
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = blocks.findIndex((b) => b.id === e.active.id);
    const to = blocks.findIndex((b) => b.id === e.over!.id);
    if (from >= 0 && to >= 0) change(arrayMove(blocks, from, to));
  };

  const addBlock = (key: SiteBlockKey) => {
    const b = newBlock(key, blockId());
    const at = selected ? blocks.findIndex((x) => x.id === selected) + 1 : blocks.length;
    change([...blocks.slice(0, at), b, ...blocks.slice(at)]);
    setSelected(b.id);
    setAdding(false);
  };

  if (!page) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  const sel = blocks.find((b) => b.id === selected) ?? null;
  const liveUrl = data.site.origin ? (page.slug ? `${data.site.origin}/${page.slug}` : `${data.site.origin}/`) : null;
  const nav = data.pages.filter((p) => p.status === "published" && p.slug && !p.hideFromNav).slice(0, 6).map((p) => ({ label: p.title, href: `/${p.slug}` }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" onClick={back} title="Back to pages">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{title || "Untitled"}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{data.business?.name}</span>
              <Badge variant={page.status === "published" ? "default" : "secondary"}>{page.status === "published" ? "Published" : "Draft"}</Badge>
              {page.status === "published" && (page.hasUnpublishedChanges || dirty) && <span className="text-amber-600">Changes not live yet</span>}
              {dirty && <span>Unsaved</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {page.status === "published" && liveUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={liveUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View live
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowVersions(true)} disabled={versions.length === 0}>
            <History className="mr-2 h-4 w-4" />
            Versions ({versions.length})
          </Button>
          <Button variant="outline" size="sm" onClick={save} disabled={!dirty || !!busy}>
            {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save draft
          </Button>
          {page.status === "published" && (
            <Button variant="outline" size="sm" onClick={unpublish} disabled={!!busy}>
              <EyeOff className="mr-2 h-4 w-4" />
              Unpublish
            </Button>
          )}
          <Button size="sm" onClick={publish} disabled={!!busy || blocks.length === 0 || placeholders.length > 0} title={placeholders.length ? "Replace the placeholders first" : undefined}>
            {busy === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            {page.status === "published" ? "Publish changes" : "Publish"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div className="space-y-4">
          {placeholders.length > 0 && (
            <Card className="border-amber-300 dark:border-amber-700">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  {placeholders.length === 1 ? "1 placeholder to replace" : `${placeholders.length} placeholders to replace`}
                </CardTitle>
                <CardDescription>The AI left these where it had no facts. Replace each with real details (or remove it) before publishing.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {placeholders.map((p, i) => (
                    <li key={`${p.blockId}-${p.path}-${i}`}>
                      <button className="w-full rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => setSelected(p.blockId)}>
                        <span className="font-medium">{p.text}</span>
                        <span className="block text-xs text-muted-foreground">{placeholderLabel(p)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="space-y-1.5">
                <Label htmlFor="pg-title">Page title</Label>
                <Input
                  id="pg-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-slug">Address</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">/</span>
                  <Input
                    id="pg-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase());
                      setDirty(true);
                    }}
                    placeholder="home page"
                  />
                </div>
              </div>
              {page.generatedFrom && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Built by AI from a prompt</summary>
                  <p className="mt-1 whitespace-pre-wrap">{page.generatedFrom}</p>
                </details>
              )}
              <button className="flex items-center gap-1 text-sm font-medium text-primary" onClick={() => setShowSeo(!showSeo)}>
                {showSeo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}Search and sharing
              </button>
              {showSeo && (
                <PageSeoFields
                  seo={seo}
                  images={data.images}
                  onChange={(s) => {
                    setSeo(s);
                    setDirty(true);
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Blocks</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={blocks.length >= MAX_BLOCKS}>
                <Plus className="mr-1 h-4 w-4" />
                Add block
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {blocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet. Add one to start.</p>}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  {blocks.map((b, i) => (
                    <BlockRow
                      key={b.id}
                      block={b}
                      index={i}
                      count={blocks.length}
                      selected={b.id === selected}
                      issue={issueFor(b.id)}
                      placeholderCount={placeholders.filter((p) => p.blockId === b.id).length}
                      onSelect={() => setSelected(b.id === selected ? null : b.id)}
                      onMove={(dir) => change(arrayMove(blocks, i, i + dir))}
                      onDuplicate={() => {
                        const copy = { ...structuredClone(b), id: blockId() };
                        change([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
                        setSelected(copy.id);
                      }}
                      onDelete={() => {
                        change(blocks.filter((x) => x.id !== b.id));
                        if (selected === b.id) setSelected(null);
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>

          {sel && (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                <div>
                  <CardTitle className="text-base">{SITE_BLOCK_DEFS[sel.blockKey].label}</CardTitle>
                  <CardDescription>{SITE_BLOCK_DEFS[sel.blockKey].description}</CardDescription>
                </div>
                {REWRITABLE.has(sel.blockKey) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" disabled={!!rewriting}>
                        {rewriting === sel.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />}
                        AI
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => rewrite(sel, "regenerate")}>Write it again</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => rewrite(sel, "shorter")}>Make it shorter</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => rewrite(sel, "persuasive")}>Make it more persuasive</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setCustomFor(sel)}>Tell the AI what to change…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardHeader>
              <CardContent>
                <FieldsEditor
                  fields={SITE_BLOCK_DEFS[sel.blockKey].fields}
                  value={sel.props}
                  resources={data}
                  onChange={(props) => change(blocks.map((b) => (b.id === sel.id ? { ...b, props } : b)))}
                />
                {issueFor(sel.id) && (
                  <ul className="mt-4 list-disc space-y-1 rounded-md bg-amber-50 p-3 pl-6 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    {issueFor(sel.id)!.messages.map((m) => (
                      <li key={m}>{friendlyIssue(sel.blockKey, m)}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-2 self-start xl:sticky xl:top-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Preview{dirty ? " (unsaved draft)" : ""}</p>
            <div className="flex gap-1">
              <Button variant={width === "desktop" ? "secondary" : "ghost"} size="icon" title="Desktop" onClick={() => setWidth("desktop")}>
                <Monitor className="h-4 w-4" />
              </Button>
              <Button variant={width === "phone" ? "secondary" : "ghost"} size="icon" title="Phone" onClick={() => setWidth("phone")}>
                <Smartphone className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <PreviewFrame
            width={width}
            message={{
              type: "danets-site-preview",
              name: data.business?.name ?? "",
              theme: data.site.theme ?? null,
              nav,
              blocks,
              ctx: { publicKey: data.business?.publicKey ?? "", appOrigin: data.appOrigin, preview: true, labels: previewLabels(data) },
              focusBlockId: selected,
            }}
          />
        </div>
      </div>

      <AddBlockDialog open={adding} onOpenChange={setAdding} onPick={addBlock} />
      <CustomRewriteDialog
        block={customFor}
        onClose={() => setCustomFor(null)}
        onSubmit={(b, text) => {
          setCustomFor(null);
          rewrite(b, "custom", text);
        }}
      />
      {showVersions && (
        <VersionsDialog
          url={url}
          versions={versions}
          dirty={dirty}
          onClose={() => setShowVersions(false)}
          onRestored={load}
        />
      )}
    </div>
  );
}

/** Blocks the AI can rewrite (see AI_BLOCK_PROPS in lib/sites/ai). */
const REWRITABLE = new Set<SiteBlockKey>(["hero", "feature-grid", "testimonials", "faq", "cta", "rich-text", "stats", "contact-details", "gallery", "booking", "lead-form", "lead-magnet"]);

function CustomRewriteDialog({ block, onClose, onSubmit }: { block: SiteBlock | null; onClose: () => void; onSubmit: (b: SiteBlock, text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog open={!!block} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rewrite this section</DialogTitle>
          <DialogDescription>Only this section changes. The AI still won&apos;t invent facts.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Focus on speed of response and add a question about pricing." />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={() => {
              if (block) onSubmit(block, text.trim());
              setText("");
            }}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Rewrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageSeoFields({ seo, onChange, images }: { seo: PageSeo; onChange: (s: PageSeo) => void; images: Resources["images"] }) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="pseo-title">Search title</Label>
        <Input id="pseo-title" value={seo.title ?? ""} onChange={(e) => onChange({ ...seo, title: e.target.value || undefined })} placeholder="Uses the page title" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pseo-desc">Search description</Label>
        <Textarea id="pseo-desc" rows={2} value={seo.description ?? ""} onChange={(e) => onChange({ ...seo, description: e.target.value || undefined })} placeholder="Uses the site default" />
      </div>
      <div className="space-y-1.5">
        <Label>Sharing image</Label>
        <ImageInput images={images} value={seo.ogImageUrl ?? ""} onChange={(v) => onChange({ ...seo, ogImageUrl: v || undefined })} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="pseo-nav">Hide from the menu</Label>
        <Switch id="pseo-nav" checked={!!seo.hideFromNav} onCheckedChange={(v) => onChange({ ...seo, hideFromNav: v || undefined })} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="pseo-noindex">Keep out of search engines</Label>
        <Switch id="pseo-noindex" checked={!!seo.noindex} onCheckedChange={(v) => onChange({ ...seo, noindex: v || undefined })} />
      </div>
    </div>
  );
}

function BlockRow({
  block,
  index,
  count,
  selected,
  issue,
  placeholderCount,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  block: SiteBlock;
  index: number;
  count: number;
  selected: boolean;
  issue?: BlockIssue;
  placeholderCount: number;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const def = SITE_BLOCK_DEFS[block.blockKey];
  const summary = typeof block.props.title === "string" && block.props.title ? block.props.title : def.description;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border bg-card p-2", selected && "border-primary ring-1 ring-primary", isDragging && "z-10 opacity-80 shadow-lg", (issue || placeholderCount > 0) && "border-amber-400")}
    >
      <button className="cursor-grab touch-none text-muted-foreground" aria-label={`Reorder ${def.label}`} {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <div className="text-sm font-medium">
          {def.label}
          {issue && <span className="ml-2 text-xs font-normal text-amber-600">Needs attention</span>}
          {!issue && placeholderCount > 0 && <span className="ml-2 text-xs font-normal text-amber-600">{placeholderCount === 1 ? "1 placeholder" : `${placeholderCount} placeholders`}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{String(summary)}</div>
      </button>
      <div className="flex shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={onDuplicate}>
          <Copy className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AddBlockDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (k: SiteBlockKey) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a block</DialogTitle>
          <DialogDescription>It goes after the selected block, or at the end.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {SITE_BLOCK_KEYS.map((k) => (
            <button key={k} className="rounded-md border p-3 text-left hover:border-primary hover:bg-accent" onClick={() => onPick(k)}>
              <div className="text-sm font-medium">{SITE_BLOCK_DEFS[k].label}</div>
              <div className="text-xs text-muted-foreground">{SITE_BLOCK_DEFS[k].description}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fields ─────────────────────────────────────────────────────────

function FieldsEditor({ fields, value, onChange, resources }: { fields: BlockField[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; resources: Resources }) {
  const set = (name: string, v: unknown) => {
    const next = { ...value };
    if (v === "" || v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <FieldInput key={f.name} field={f} value={value[f.name]} onChange={(v) => set(f.name, v)} resources={resources} />
      ))}
    </div>
  );
}

function FieldInput({ field: f, value, onChange, resources }: { field: BlockField; value: unknown; onChange: (v: unknown) => void; resources: Resources }) {
  const id = useId();
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const required = "required" in f && f.required;
  const label = (
    <Label htmlFor={id}>
      {f.label}
      {required && <span className="text-destructive"> *</span>}
    </Label>
  );

  switch (f.type) {
    case "textarea":
      return (
        <div className="space-y-1.5">
          {label}
          <Textarea id={id} rows={3} value={str} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      );
    case "image":
      return (
        <div className="space-y-1.5">
          {label}
          <ImageInput id={id} images={resources.images} value={str} onChange={onChange} />
        </div>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={str || undefined} onValueChange={onChange}>
            <SelectTrigger id={id}>
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "booking-type":
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={str || "__all"} onValueChange={(v) => onChange(v === "__all" ? "" : v)}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Let visitors choose</SelectItem>
              {resources.bookingTypes.map((b) => (
                <SelectItem key={b.slug} value={b.slug}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {resources.bookingTypes.length === 0 && <p className="text-xs text-muted-foreground">The tenant has no booking types yet.</p>}
        </div>
      );
    case "form":
    case "lead-magnet": {
      const options = f.type === "form" ? resources.forms.map((x) => ({ id: x.id, label: x.name })) : resources.magnets.map((x) => ({ id: x.id, label: x.status === "published" ? x.title : `${x.title} (draft: publish it first)` }));
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={str || undefined} onValueChange={onChange}>
            <SelectTrigger id={id}>
              <SelectValue placeholder={f.type === "form" ? "Choose a form" : "Choose a lead magnet"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.length === 0 && <p className="text-xs text-muted-foreground">{f.type === "form" ? "The tenant has no active forms yet." : "The tenant has no lead magnets yet."}</p>}
        </div>
      );
    }
    case "list":
      return <ListField field={f} value={value} onChange={onChange} resources={resources} />;
    default:
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            id={id}
            type={f.type === "email" ? "email" : "text"}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            placeholder={f.placeholder ?? (f.type === "href" ? "/page, #section or https://…" : f.type === "video" ? "https://www.youtube.com/watch?v=…" : undefined)}
          />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      );
  }
}

function ListField({ field: f, value, onChange, resources }: { field: Extract<BlockField, { type: "list" }>; value: unknown; onChange: (v: unknown) => void; resources: Resources }) {
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const [open, setOpen] = useState<number | null>(items.length ? 0 : null);
  const set = (next: Record<string, unknown>[]) => onChange(next);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          {f.label} <span className="font-normal text-muted-foreground">({items.length})</span>
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={items.length >= f.max}
          onClick={() => {
            set([...items, {}]);
            setOpen(items.length);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add {f.itemLabel.toLowerCase()}
        </Button>
      </div>
      {items.map((item, i) => {
        const first = f.fields[0] ? item[f.fields[0].name] : "";
        return (
          <div key={i} className="rounded-md border">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setOpen(open === i ? null : i)}>
                {f.itemLabel} {i + 1}
                {typeof first === "string" && first && <span className="text-muted-foreground">: {first}</span>}
              </button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move up" disabled={i === 0} onClick={() => set(arrayMove(items, i, i - 1))}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move down" disabled={i === items.length - 1} onClick={() => set(arrayMove(items, i, i + 1))}>
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Remove" onClick={() => set(items.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {open === i && (
              <div className="border-t p-3">
                <FieldsEditor fields={f.fields} value={item} resources={resources} onChange={(v) => set(items.map((x, j) => (j === i ? v : x)))} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Preview and versions ───────────────────────────────────────────

function PreviewFrame({ width, message }: { width: "desktop" | "phone"; message: Record<string, unknown> }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef(message);
  useEffect(() => {
    latest.current = message;
  });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      if ((e.data as { type?: string })?.type === "danets-site-preview-ready") {
        setReady(true);
        ref.current?.contentWindow?.postMessage(latest.current, window.location.origin);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const serialized = JSON.stringify(message);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => ref.current?.contentWindow?.postMessage(JSON.parse(serialized), window.location.origin), 150);
    return () => clearTimeout(t);
  }, [serialized, ready]);

  return (
    <div className="flex justify-center overflow-hidden rounded-lg border bg-muted/40 p-2">
      <iframe
        ref={ref}
        src="/site-preview"
        title="Page preview"
        className="h-[calc(100vh-10rem)] min-h-[480px] rounded-md border bg-white transition-[width]"
        style={{ width: width === "phone" ? 390 : "100%" }}
      />
    </div>
  );
}

function VersionsDialog({ url, versions, dirty, onClose, onRestored }: { url: string; versions: Version[]; dirty: boolean; onClose: () => void; onRestored: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (v: Version) => {
    if (dirty && !window.confirm("Restoring replaces your unsaved changes. Continue?")) return;
    setBusy(v.id);
    try {
      await api(url, { method: "POST", json: { action: "restore", versionId: v.id } });
      toast.success("That version is live again.");
      onClose();
      onRestored();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Published versions</DialogTitle>
          <DialogDescription>Restoring puts a version live and makes it the draft.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] divide-y overflow-y-auto">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {new Date(v.createdAt).toLocaleString()}
                  {v.live && <Badge className="ml-2">Live</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {v.title} · {v.blockCount} blocks{v.publishedBy ? ` · ${v.publishedBy}` : ""}
                  {v.restoredFrom ? " · restored" : ""}
                </div>
              </div>
              {!v.live && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => restore(v)}>
                  {busy === v.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
