"use client";

// Website (Phase 2, workstream Q): the tenant's own site on <sub>.SITES_DOMAIN.
// Set the site up, theme it, and build pages from blocks with a live preview,
// versions and publishing.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
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
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
  Upload,
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
import { MediaPickerDialog } from "@/components/dashboard/views/media-library";
import {
  DEFAULT_THEME,
  MAX_BLOCKS,
  SITE_BLOCK_DEFS,
  SITE_BLOCK_KEYS,
  SITE_FONTS,
  newBlock,
  validateBlocks,
  type BlockField,
  type BlockIssue,
  type PageSeo,
  type SiteBlock,
  type SiteBlockKey,
  type SiteSeoDefaults,
  type SiteTheme,
} from "@/lib/sites/blocks";
import { cn } from "@/lib/utils";

interface Viewer {
  role: string;
}

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
}

interface SiteDomain {
  domain: string;
  status: "pending" | "verified" | "failed";
  txtName: string;
  txtValue: string | null;
  cnameTarget: string | null;
  requestedAt: string | null;
  checkedAt: string | null;
  verifiedAt: string | null;
  problem: string | null;
}

interface SiteData {
  canEdit: boolean;
  sitesConfigured: boolean;
  sitesDomain: string | null;
  businessName: string;
  publicKey: string;
  appOrigin: string;
  bookingTypes: { slug: string; name: string }[];
  limit: { used: number; limit: number };
  suggestedSubdomain?: string;
  site: null | {
    id: string;
    subdomain: string;
    origin: string | null;
    subdomainOrigin: string | null;
    domainAllowed: boolean;
    domain: SiteDomain | null;
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

export function WebsiteView({ user }: { user: Viewer }) {
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<SiteData>("/api/site"));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  const canEdit = data.canEdit && user.role === "admin";

  if (!data.site) {
    return (
      <div className="space-y-6">
        <Header />
        <SetupCard data={data} canEdit={canEdit} onDone={load} />
      </div>
    );
  }

  if (editing) {
    return (
      <PageEditor
        pageId={editing}
        data={data}
        canEdit={canEdit}
        onBack={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Header origin={data.site.origin} status={data.site.status} />
      <PagesCard data={data} canEdit={canEdit} onChange={load} onEdit={setEditing} />
      <DomainCard data={data} canEdit={canEdit} onChange={load} />
      <SettingsCard data={data} canEdit={canEdit} onSaved={load} />
    </div>
  );
}

function Header({ origin, status }: { origin?: string | null; status?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Website</h1>
        <p className="text-sm text-muted-foreground">Pages for your business, with your chat widget built in.</p>
      </div>
      {origin && (
        <div className="flex items-center gap-2">
          {status === "suspended" && <Badge variant="destructive">Suspended by the platform</Badge>}
          <Button variant="outline" size="sm" asChild>
            <a href={origin} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              {origin.replace(/^https?:\/\//, "")}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Setup ──────────────────────────────────────────────────────────

function SetupCard({ data, canEdit, onDone }: { data: SiteData; canEdit: boolean; onDone: () => void }) {
  const [sub, setSub] = useState(data.suggestedSubdomain ?? "");
  const [busy, setBusy] = useState(false);
  if (!data.sitesConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Websites aren&apos;t switched on yet</CardTitle>
          <CardDescription>The platform hasn&apos;t set a website domain on this server. Ask your platform administrator.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const create = async () => {
    setBusy(true);
    try {
      await api("/api/site", { method: "POST", json: { subdomain: sub } });
      toast.success("Your website is ready, with a starter home page.");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your website</CardTitle>
        <CardDescription>Choose your address. You can change it later, but links you&apos;ve shared would stop working.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex max-w-xl items-center gap-2">
          <Input value={sub} onChange={(e) => setSub(e.target.value.toLowerCase())} disabled={!canEdit} aria-label="Website address" />
          <span className="shrink-0 text-sm text-muted-foreground">.{data.sitesDomain}</span>
        </div>
        {canEdit ? (
          <Button onClick={create} disabled={busy || !sub}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create website
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only admins can set up the website.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Pages ──────────────────────────────────────────────────────────

function PagesCard({ data, canEdit, onChange, onEdit }: { data: SiteData; canEdit: boolean; onChange: () => void; onEdit: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SitePage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { used, limit } = data.limit;

  const act = async (p: SitePage, action: "publish" | "unpublish") => {
    setBusy(p.id);
    try {
      await api(`/api/site/pages/${p.id}/${action}`, { method: "POST" });
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
      await api(`/api/site/pages/${deleting.id}`, { method: "DELETE" });
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
            {limit > 0 ? `${used} of ${limit} published pages on your plan.` : `${used} published.`} Views and leads count from each page&apos;s first visit.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New page
          </Button>
        )}
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
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => act(p, p.status === "published" ? "unpublish" : "publish")}>
                            {p.status === "published" ? "Unpublish" : "Publish"}
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleting(p)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
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
      <NewPageDialog open={creating} onOpenChange={setCreating} hasHome={data.pages.some((p) => p.slug === "")} onCreated={(id) => onEdit(id)} />
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

function NewPageDialog({ open, onOpenChange, hasHome, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; hasHome: boolean; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState<"blank" | "home">("blank");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const d = await api<{ page: { id: string } }>("/api/site/pages", { method: "POST", json: { title, slug: slugTouched ? slug : slugify(title), template } });
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

// ─── Custom domain ──────────────────────────────────────────────────

function CopyValue({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => toast.success("Copied."),
            () => toast.error("Couldn't copy. Select the text instead.")
          );
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}

function DomainCard({ data, canEdit, onChange }: { data: SiteData; canEdit: boolean; onChange: () => void }) {
  const site = data.site!;
  const d = site.domain;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<null | "add" | "check" | "remove">(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const call = async (kind: "add" | "check" | "remove") => {
    setBusy(kind);
    try {
      if (kind === "add") {
        await api("/api/site/domain", { method: "POST", json: { domain: input } });
        setInput("");
      } else if (kind === "remove") {
        await api("/api/site/domain", { method: "DELETE" });
        toast.success("Domain removed. Your site is back on its Danets address.");
      } else {
        const r = await api<{ domain: SiteDomain | null }>("/api/site/domain/check", { method: "POST" });
        if (r.domain?.status === "verified") toast.success(`${r.domain.domain} is connected.`);
        else toast.message("Not verified yet. We keep checking every 10 minutes.");
      }
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  };

  // A bare domain (example.com) can't have a CNAME.
  const apex = d ? d.domain.split(".").length === 2 : false;
  const danetsAddress = site.subdomainOrigin?.replace(/^https?:\/\//, "") ?? "your Danets address";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your own domain</CardTitle>
        <CardDescription>
          Use an address like www.yourbusiness.com instead of {danetsAddress}. The Danets address keeps working and sends visitors to your domain.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!site.domainAllowed ? (
          <p className="text-sm text-muted-foreground">Custom domains are on the Pro plan and above. Upgrade under Subscription to connect one.</p>
        ) : !d ? (
          canEdit ? (
            <div className="flex max-w-xl gap-2">
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="www.yourbusiness.com" aria-label="Your domain" />
              <Button onClick={() => call("add")} disabled={!input.trim() || !!busy}>
                {busy === "add" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No domain connected. Only admins can add one.</p>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.domain}</span>
              {d.status === "verified" ? (
                <Badge className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </Badge>
              ) : d.status === "pending" ? (
                <Badge variant="secondary">Waiting for DNS</Badge>
              ) : (
                <Badge variant="destructive">Not verified</Badge>
              )}
              {d.status === "verified" && site.origin && (
                <a href={site.origin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {d.problem && (
              <p
                className={cn(
                  "flex items-start gap-2 rounded-md p-3 text-sm",
                  d.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                )}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {d.problem}
              </p>
            )}

            {(d.status !== "verified" || d.problem) && (
              <div className="space-y-2">
                <p className="text-sm">Add these two records where you manage your domain&apos;s DNS, then check:</p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.cnameTarget && (
                        <tr className="border-t">
                          <td className="px-3 py-2">{apex ? "ALIAS or ANAME" : "CNAME"}</td>
                          <td className="px-3 py-2">
                            <CopyValue value={d.domain} />
                          </td>
                          <td className="px-3 py-2">
                            <CopyValue value={d.cnameTarget} />
                          </td>
                        </tr>
                      )}
                      <tr className="border-t">
                        <td className="px-3 py-2">TXT</td>
                        <td className="px-3 py-2">
                          <CopyValue value={d.txtName} />
                        </td>
                        <td className="px-3 py-2">{d.txtValue && <CopyValue value={d.txtValue} />}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  {apex ? "A domain without www can't use a CNAME; most DNS providers offer ALIAS, ANAME or CNAME flattening instead, or connect the www address. " : ""}
                  Keep the TXT record after the domain connects: we re-check it daily. New records can take a few hours to appear; we check every 10 minutes for 72 hours.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => call("check")} disabled={!!busy}>
                  {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  {d.status === "failed" ? "Check again" : "Check now"}
                </Button>
              )}
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={!!busy}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove domain
                </Button>
              )}
              {d.checkedAt && <span className="text-xs text-muted-foreground">Last checked {new Date(d.checkedAt).toLocaleString()}</span>}
            </div>
          </>
        )}
      </CardContent>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {d?.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your website stops answering on that domain straight away and goes back to its Danets address. You can connect it again later, with new records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => call("remove")}>Remove domain</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Settings ───────────────────────────────────────────────────────

function ImageInput({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
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
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or choose from the library" disabled={disabled} />
      <Button type="button" variant="outline" size="icon" title="Choose from the media library" onClick={() => setPicking(true)} disabled={disabled}>
        <Upload className="h-4 w-4" />
      </Button>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" title="Remove" onClick={() => onChange("")}>
          <X className="h-4 w-4" />
        </Button>
      )}
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        kind="image"
        title="Choose an image"
        onSelect={(items) => {
          if (items[0]) onChange(items[0].url);
          setPicking(false);
        }}
      />
    </div>
  );
}

function ColorInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 w-12 cursor-pointer rounded border bg-transparent" aria-label={label} />
        <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn("w-32 font-mono", !valid && "border-destructive")} />
      </div>
    </div>
  );
}

function SettingsCard({ data, canEdit, onSaved }: { data: SiteData; canEdit: boolean; onSaved: () => void }) {
  const site = data.site!;
  const [subdomain, setSubdomain] = useState(site.subdomain);
  const [theme, setTheme] = useState<SiteTheme>({ ...DEFAULT_THEME, ...site.theme });
  const [seo, setSeo] = useState<SiteSeoDefaults>(site.seoDefaults);
  const [widget, setWidget] = useState(site.widgetEnabled);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined));
      await api("/api/site", {
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
            <Input id="site-sub" value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase())} disabled={!canEdit} />
            <span className="shrink-0 text-sm text-muted-foreground">.{data.sitesDomain}</span>
          </div>
          {subdomain !== site.subdomain && <p className="text-xs text-amber-600">Links to the old address will stop working.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput label="Main colour" value={theme.primaryColor ?? ""} onChange={(v) => setTheme({ ...theme, primaryColor: v })} disabled={!canEdit} />
          <ColorInput label="Accent colour" value={theme.accentColor ?? ""} onChange={(v) => setTheme({ ...theme, accentColor: v })} disabled={!canEdit} />
          <div className="space-y-1.5">
            <Label>Font</Label>
            <Select value={theme.font ?? "system"} onValueChange={(v) => setTheme({ ...theme, font: v as SiteTheme["font"] })} disabled={!canEdit}>
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
          <ImageInput id="site-logo" value={theme.logoUrl ?? ""} onChange={(v) => setTheme({ ...theme, logoUrl: v })} disabled={!canEdit} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seo-suffix">Added to every page title</Label>
            <Input id="seo-suffix" value={seo.titleSuffix ?? ""} onChange={(e) => setSeo({ ...seo, titleSuffix: e.target.value })} placeholder={`| ${data.businessName}`} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seo-og">Default sharing image</Label>
            <ImageInput id="seo-og" value={seo.ogImageUrl ?? ""} onChange={(v) => setSeo({ ...seo, ogImageUrl: v })} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="seo-desc">Default search description</Label>
            <Textarea id="seo-desc" rows={2} value={seo.description ?? ""} onChange={(e) => setSeo({ ...seo, description: e.target.value })} disabled={!canEdit} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Chat widget on every page</p>
            <p className="text-xs text-muted-foreground">Visitors can chat with your AI assistant. Uses your widget settings.</p>
          </div>
          <Switch checked={widget} onCheckedChange={setWidget} disabled={!canEdit} />
        </div>
        {canEdit && (
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings
          </Button>
        )}
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
  hasUnpublishedChanges: boolean;
  versions: number;
}

function PageEditor({ pageId, data, canEdit, onBack }: { pageId: string; data: SiteData; canEdit: boolean; onBack: () => void }) {
  const [page, setPage] = useState<PageDraft | null>(null);
  const [blocks, setBlocks] = useState<SiteBlock[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [seo, setSeo] = useState<PageSeo>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish">(null);
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [adding, setAdding] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showSeo, setShowSeo] = useState(false);
  const [serverIssues, setServerIssues] = useState<BlockIssue[]>([]);

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
      const d = await api<{ page: PageDraft }>(`/api/site/pages/${pageId}`);
      apply(d.page);
    } catch (e: any) {
      toast.error(e.message);
      onBack();
    }
  }, [pageId, apply, onBack]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const issues = useMemo(() => validateBlocks(blocks).issues, [blocks]);
  const issueFor = (id: string) => issues.find((i) => i.blockId === id) ?? serverIssues.find((i) => i.blockId === id);

  const change = (next: SiteBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    setBusy("save");
    try {
      const d = await api<{ page: PageDraft }>(`/api/site/pages/${pageId}`, { method: "PATCH", json: { title, slug, blocks, seo } });
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
      await api(`/api/site/pages/${pageId}/publish`, { method: "POST" });
      toast.success("Published. Visitors now see this version.");
      await load();
    } catch (e: any) {
      if (e.data?.issues) {
        setServerIssues(e.data.issues);
        setSelected(e.data.issues[0]?.blockId ?? null);
      }
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    setBusy("unpublish");
    try {
      await api(`/api/site/pages/${pageId}/unpublish`, { method: "POST" });
      toast.success("Taken offline. The draft is kept.");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
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
  const url = data.site?.origin ? (page.slug ? `${data.site.origin}/${page.slug}` : `${data.site.origin}/`) : null;
  const nav = data.pages.filter((p) => p.status === "published" && p.slug && !p.hideFromNav).slice(0, 6).map((p) => ({ label: p.title, href: `/${p.slug}` }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" onClick={back} title="Back to pages">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{title || "Untitled"}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={page.status === "published" ? "default" : "secondary"}>{page.status === "published" ? "Published" : "Draft"}</Badge>
              {page.status === "published" && (page.hasUnpublishedChanges || dirty) && <span className="text-amber-600">Changes not live yet</span>}
              {dirty && <span>Unsaved</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {page.status === "published" && url && (
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View live
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowVersions(true)} disabled={page.versions === 0}>
            <History className="mr-2 h-4 w-4" />
            Versions ({page.versions})
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" size="sm" onClick={save} disabled={!dirty || !!busy}>
                {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save draft
              </Button>
              {page.status === "published" && (
                <Button variant="outline" size="sm" onClick={unpublish} disabled={!!busy}>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Unpublish
                </Button>
              )}
              <Button size="sm" onClick={publish} disabled={!!busy || blocks.length === 0}>
                {busy === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                {page.status === "published" ? "Publish changes" : "Publish"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div className="space-y-4">
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
                  disabled={!canEdit}
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
                    disabled={!canEdit}
                  />
                </div>
              </div>
              <button className="flex items-center gap-1 text-sm font-medium text-primary" onClick={() => setShowSeo(!showSeo)}>
                {showSeo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}Search and sharing
              </button>
              {showSeo && (
                <PageSeoFields
                  seo={seo}
                  disabled={!canEdit}
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
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={blocks.length >= MAX_BLOCKS}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add block
                </Button>
              )}
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
                      canEdit={canEdit}
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
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{SITE_BLOCK_DEFS[sel.blockKey].label}</CardTitle>
                <CardDescription>{SITE_BLOCK_DEFS[sel.blockKey].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldsEditor
                  fields={SITE_BLOCK_DEFS[sel.blockKey].fields}
                  value={sel.props}
                  bookingTypes={data.bookingTypes}
                  disabled={!canEdit}
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
              name: data.businessName,
              theme: data.site?.theme ?? null,
              nav,
              blocks,
              ctx: { publicKey: data.publicKey, appOrigin: data.appOrigin },
              focusBlockId: selected,
            }}
          />
        </div>
      </div>

      <AddBlockDialog open={adding} onOpenChange={setAdding} onPick={addBlock} />
      {showVersions && <VersionsDialog pageId={pageId} canEdit={canEdit} dirty={dirty} onClose={() => setShowVersions(false)} onRestored={load} />}
    </div>
  );
}

function PageSeoFields({ seo, onChange, disabled }: { seo: PageSeo; onChange: (s: PageSeo) => void; disabled?: boolean }) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="pseo-title">Search title</Label>
        <Input id="pseo-title" value={seo.title ?? ""} onChange={(e) => onChange({ ...seo, title: e.target.value || undefined })} placeholder="Uses the page title" disabled={disabled} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pseo-desc">Search description</Label>
        <Textarea id="pseo-desc" rows={2} value={seo.description ?? ""} onChange={(e) => onChange({ ...seo, description: e.target.value || undefined })} placeholder="Uses the site default" disabled={disabled} />
      </div>
      <div className="space-y-1.5">
        <Label>Sharing image</Label>
        <ImageInput value={seo.ogImageUrl ?? ""} onChange={(v) => onChange({ ...seo, ogImageUrl: v || undefined })} disabled={disabled} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="pseo-nav">Hide from the menu</Label>
        <Switch id="pseo-nav" checked={!!seo.hideFromNav} onCheckedChange={(v) => onChange({ ...seo, hideFromNav: v || undefined })} disabled={disabled} />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="pseo-noindex">Keep out of search engines</Label>
        <Switch id="pseo-noindex" checked={!!seo.noindex} onCheckedChange={(v) => onChange({ ...seo, noindex: v || undefined })} disabled={disabled} />
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
  canEdit,
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
  canEdit: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: !canEdit });
  const def = SITE_BLOCK_DEFS[block.blockKey];
  const summary = typeof block.props.title === "string" && block.props.title ? block.props.title : def.description;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border bg-card p-2", selected && "border-primary ring-1 ring-primary", isDragging && "z-10 opacity-80 shadow-lg", issue && "border-amber-400")}
    >
      {canEdit && (
        <button className="cursor-grab touch-none text-muted-foreground" aria-label={`Reorder ${def.label}`} {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <div className="text-sm font-medium">
          {def.label}
          {issue && <span className="ml-2 text-xs font-normal text-amber-600">Needs attention</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{String(summary)}</div>
      </button>
      {canEdit && (
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
      )}
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
        <div className="grid gap-2 sm:grid-cols-2">
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

function FieldsEditor({
  fields,
  value,
  onChange,
  bookingTypes,
  disabled,
}: {
  fields: BlockField[];
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  bookingTypes: { slug: string; name: string }[];
  disabled?: boolean;
}) {
  const set = (name: string, v: unknown) => {
    const next = { ...value };
    if (v === "" || v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <FieldInput key={f.name} field={f} value={value[f.name]} onChange={(v) => set(f.name, v)} bookingTypes={bookingTypes} disabled={disabled} />
      ))}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
  bookingTypes,
  disabled,
}: {
  field: BlockField;
  value: unknown;
  onChange: (v: unknown) => void;
  bookingTypes: { slug: string; name: string }[];
  disabled?: boolean;
}) {
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
          <Textarea id={id} rows={3} value={str} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      );
    case "image":
      return (
        <div className="space-y-1.5">
          {label}
          <ImageInput id={id} value={str} onChange={onChange} disabled={disabled} />
        </div>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={str || undefined} onValueChange={onChange} disabled={disabled}>
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
          <Select value={str || "__all"} onValueChange={(v) => onChange(v === "__all" ? "" : v)} disabled={disabled}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Let visitors choose</SelectItem>
              {bookingTypes.map((b) => (
                <SelectItem key={b.slug} value={b.slug}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {bookingTypes.length === 0 && <p className="text-xs text-muted-foreground">Add a booking type under Leads → Bookings first.</p>}
        </div>
      );
    case "list":
      return <ListField field={f} value={value} onChange={onChange} bookingTypes={bookingTypes} disabled={disabled} />;
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
            disabled={disabled}
          />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      );
  }
}

function ListField({
  field: f,
  value,
  onChange,
  bookingTypes,
  disabled,
}: {
  field: Extract<BlockField, { type: "list" }>;
  value: unknown;
  onChange: (v: unknown) => void;
  bookingTypes: { slug: string; name: string }[];
  disabled?: boolean;
}) {
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const [open, setOpen] = useState<number | null>(items.length ? 0 : null);
  const set = (next: Record<string, unknown>[]) => onChange(next);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          {f.label} <span className="font-normal text-muted-foreground">({items.length})</span>
        </Label>
        {!disabled && (
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
        )}
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
              {!disabled && (
                <>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move up" disabled={i === 0} onClick={() => set(arrayMove(items, i, i - 1))}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move down" disabled={i === items.length - 1} onClick={() => set(arrayMove(items, i, i + 1))}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Remove" onClick={() => set(items.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
            {open === i && (
              <div className="border-t p-3">
                <FieldsEditor fields={f.fields} value={item} bookingTypes={bookingTypes} disabled={disabled} onChange={(v) => set(items.map((x, j) => (j === i ? v : x)))} />
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

interface Version {
  id: string;
  title: string;
  publishedBy: string | null;
  restoredFrom: string | null;
  createdAt: string;
  blockCount: number;
  live: boolean;
}

function VersionsDialog({ pageId, canEdit, dirty, onClose, onRestored }: { pageId: string; canEdit: boolean; dirty: boolean; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<{ versions: Version[] }>(`/api/site/pages/${pageId}/versions`)
      .then((d) => setVersions(d.versions))
      .catch((e) => toast.error(e.message));
  }, [pageId]);

  const restore = async (v: Version) => {
    if (dirty && !window.confirm("Restoring replaces your unsaved changes. Continue?")) return;
    setBusy(v.id);
    try {
      await api(`/api/site/pages/${pageId}/versions/${v.id}/restore`, { method: "POST" });
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
        {!versions ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
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
                {canEdit && !v.live && (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => restore(v)}>
                    {busy === v.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
