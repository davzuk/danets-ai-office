"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Loader2,
  Save,
  RefreshCw,
  GripVertical,
  ExternalLink,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type CmsPage = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};

type CmsPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: string;
  updatedAt: string;
  author: { name: string } | null;
  tags: { id: string; slug: string; name: string }[];
};

type CmsNavItem = {
  id?: string;
  parentId: string | null;
  label: string;
  href: string;
  order: number;
  visible: boolean;
  icon: string | null;
};

type CmsBlock = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  schema: unknown;
  defaultProps: Record<string, unknown>;
  icon: string | null;
  isActive: boolean;
};

type CmsContact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string;
  pageSlug: string | null;
  createdAt: string;
};

// ─── Pages ────────────────────────────────────────────────────────

export function CmsPagesPanel() {
  const [pages, setPages] = React.useState<CmsPage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<CmsPage | null>(null);
  const [creating, setCreating] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/pages");
      const data = await res.json();
      setPages(data.pages ?? []);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Marketing pages</CardTitle>
          <CardDescription>
            Pages are rendered on the public marketing site at
            /&lt;slug&gt;. The home page lives at slug <code>home</code>.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New page
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pages…
          </div>
        ) : pages.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No pages yet — create one to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell>
                    <code className="text-xs">/{p.slug}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {p.status === "published" ? (
                        <a
                          href={`/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View
                        </a>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {(editing || creating) && (
        <PageEditorDialog
          page={editing}
          open={!!(editing || creating)}
          onOpenChange={(o) => {
            if (!o) {
              setEditing(null);
              setCreating(false);
            }
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </Card>
  );
}

function PageEditorDialog({
  page,
  open,
  onOpenChange,
  onSaved,
}: {
  page: CmsPage | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isNew = !page;
  const [title, setTitle] = React.useState(page?.title ?? "");
  const [slug, setSlug] = React.useState(page?.slug ?? "");
  const [description, setDescription] = React.useState(
    page?.description ?? ""
  );
  const [status, setStatus] = React.useState<string>(
    page?.status ?? "draft"
  );
  const [blocksJson, setBlocksJson] = React.useState("[]");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!page) {
      setBlocksJson("[]");
      return;
    }
    fetch(`/api/super-admin/cms/pages/${page.id}`)
      .then((r) => r.json())
      .then((data) => {
        setBlocksJson(JSON.stringify(data.page?.blocks ?? [], null, 2));
      });
  }, [page]);

  async function save() {
    setSaving(true);
    try {
      let blocks;
      try {
        blocks = JSON.parse(blocksJson);
      } catch {
        toast.error("Blocks JSON is invalid");
        setSaving(false);
        return;
      }
      const payload = {
        title,
        slug: slug || undefined,
        description: description || undefined,
        status,
        blocks,
      };
      const res = await fetch(
        isNew
          ? "/api/super-admin/cms/pages"
          : `/api/super-admin/cms/pages/${page!.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success(isNew ? "Page created" : "Page saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!page) return;
    if (!confirm(`Delete page "${page.title}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/cms/pages/${page.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      toast.success("Page deleted");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Create page" : `Edit ${page?.title}`}</DialogTitle>
          <DialogDescription>
            Pages are composed of CMS blocks. Edit the blocks array as JSON,
            or use a CMS-aware editor (coming soon).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (isNew && !slug) {
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "")
                    );
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="kebab-case"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description (SEO)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Blocks (JSON)</Label>
            <Textarea
              value={blocksJson}
              onChange={(e) => setBlocksJson(e.target.value)}
              rows={14}
              className="font-mono text-xs"
              placeholder='[{ "blockKey": "hero", "props": { ... } }]'
            />
            <p className="text-[11px] text-muted-foreground">
              Each entry needs <code>blockKey</code> (must exist in the
              Blocks library) and a <code>props</code> object.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {!isNew ? (
            <Button variant="destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Posts ────────────────────────────────────────────────────────

export function CmsPostsPanel() {
  const [posts, setPosts] = React.useState<CmsPost[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<CmsPost | null>(null);
  const [creating, setCreating] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/posts");
      const data = await res.json();
      setPosts(data.posts ?? []);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Blog posts</CardTitle>
          <CardDescription>
            Posts published here appear on <code>/blog</code> and the RSS
            feed.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New post
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading posts…
          </div>
        ) : posts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No posts yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell>
                    <code className="text-xs">/{p.slug}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.author?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(p)}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {(editing || creating) && (
        <PostEditorDialog
          post={editing}
          open={!!(editing || creating)}
          onOpenChange={(o) => {
            if (!o) {
              setEditing(null);
              setCreating(false);
            }
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </Card>
  );
}

function PostEditorDialog({
  post,
  open,
  onOpenChange,
  onSaved,
}: {
  post: CmsPost | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isNew = !post;
  const [title, setTitle] = React.useState(post?.title ?? "");
  const [slug, setSlug] = React.useState(post?.slug ?? "");
  const [excerpt, setExcerpt] = React.useState(post?.excerpt ?? "");
  const [body, setBody] = React.useState("");
  const [status, setStatus] = React.useState(post?.status ?? "draft");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!post) {
      setBody("");
      return;
    }
    fetch(`/api/super-admin/cms/posts/${post.id}`)
      .then((r) => r.json())
      .then((data) => {
        setBody(data.post?.bodyMdx ?? "");
      });
  }, [post]);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        title,
        slug: slug || undefined,
        excerpt: excerpt || undefined,
        bodyMdx: body,
        status,
      };
      const res = await fetch(
        isNew
          ? "/api/super-admin/cms/posts"
          : `/api/super-admin/cms/posts/${post!.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success(isNew ? "Post created" : "Post saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!post) return;
    if (!confirm(`Delete post "${post.title}"?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/super-admin/cms/posts/${post.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      toast.success("Post deleted");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Create post" : `Edit ${post?.title}`}
          </DialogTitle>
          <DialogDescription>
            Body is rendered as markdown (with safe HTML disabled).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (isNew && !slug) {
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "")
                    );
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Excerpt</Label>
            <Textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Body (markdown)</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="font-mono text-xs"
              placeholder="# Heading&#10;&#10;Write your post in markdown…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {!isNew ? (
            <Button variant="destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────

export function CmsNavPanel() {
  const [items, setItems] = React.useState<CmsNavItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/nav");
      const data = await res.json();
      // Strip server-only id when editing
      setItems(
        (data.items ?? []).map((it: any) => ({
          parentId: it.parentId,
          label: it.label,
          href: it.href,
          order: it.order,
          visible: it.visible,
          icon: it.icon,
        }))
      );
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  function add() {
    setItems((p) => [
      ...p,
      { parentId: null, label: "New link", href: "/", order: p.length, visible: true, icon: null },
    ]);
  }
  function remove(idx: number) {
    setItems((p) => p.filter((_, i) => i !== idx));
  }
  function update(idx: number, patch: Partial<CmsNavItem>) {
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function move(idx: number, dir: -1 | 1) {
    setItems((p) => {
      const next = [...p];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return p;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((it, i) => ({ ...it, order: i }));
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/cms/nav", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Navigation saved");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Top navigation</CardTitle>
          <CardDescription>
            Drag-free editor — reorder with the arrow buttons. Top-level
            items appear in the header; child items become dropdowns.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="h-4 w-4 mr-1" /> Add link
          </Button>
          <Button size="sm" onClick={save} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save navigation
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No nav items yet — add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div
                key={idx}
                className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-2"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={it.label}
                  onChange={(e) => update(idx, { label: e.target.value })}
                  placeholder="Label"
                  className="w-40"
                />
                <Input
                  value={it.href}
                  onChange={(e) => update(idx, { href: e.target.value })}
                  placeholder="/pricing"
                  className="w-48"
                />
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => update(idx, { visible: !it.visible })}
                    title={it.visible ? "Hide" : "Show"}
                  >
                    {it.visible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Blocks ───────────────────────────────────────────────────────

export function CmsBlocksPanel() {
  const [blocks, setBlocks] = React.useState<CmsBlock[]>([]);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/blocks");
      const data = await res.json();
      setBlocks(data.blocks ?? []);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Block library</CardTitle>
        <CardDescription>
          Built-in building blocks available to pages. Block schemas are
          defined by the renderer in <code>src/components/marketing/blocks/</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <code className="text-xs">{b.key}</code>
                  </TableCell>
                  <TableCell className="font-medium">{b.label}</TableCell>
                  <TableCell>
                    {b.isActive ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {b.description ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Contacts ────────────────────────────────────────────────────

export function CmsContactsPanel() {
  const [contacts, setContacts] = React.useState<CmsContact[]>([]);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/contacts");
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Contact inbox</CardTitle>
          <CardDescription>
            Submissions from the public /contact form. Each one also creates
            a Lead in the CRM so you can track and respond from the leads
            dashboard.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No contact submissions yet.
          </div>
        ) : (
          <div className="space-y-3">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">{c.name}</span>
                  <a
                    href={`mailto:${c.email}`}
                    className="text-primary hover:underline"
                  >
                    {c.email}
                  </a>
                  {c.phone ? (
                    <span className="text-muted-foreground">{c.phone}</span>
                  ) : null}
                  {c.company ? (
                    <Badge variant="secondary">{c.company}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                  {c.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Site Settings ───────────────────────────────────────────────

export function CmsSitePanel() {
  const [site, setSite] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [brandName, setBrandName] = React.useState("Danets AI Automation");
  const [tagline, setTagline] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [supportEmail, setSupportEmail] = React.useState("");
  const [primaryColor, setPrimaryColor] = React.useState("#1d4ed8");
  const [accentColor, setAccentColor] = React.useState("#84cc16");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/site");
      const data = await res.json();
      const s = data.site;
      setSite(s);
      if (s) {
        setBrandName(s.brandName ?? "");
        setTagline(s.tagline ?? "");
        setDescription(s.description ?? "");
        setSupportEmail(s.supportEmail ?? "");
        setPrimaryColor(s.primaryColor ?? "#1d4ed8");
        setAccentColor(s.accentColor ?? "#84cc16");
      }
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/cms/site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName,
          tagline: tagline || null,
          description: description || null,
          supportEmail: supportEmail || null,
          primaryColor,
          accentColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Site settings saved");
      setSite(data.site);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Site settings</CardTitle>
        <CardDescription>
          Brand, contact and SEO defaults for the marketing site. These
          power the header, footer and default meta tags.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4 max-w-xl">
            <div className="space-y-1.5">
              <Label className="text-xs">Brand name</Label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tagline</Label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Support email</Label>
              <Input
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Primary color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Accent color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "published"
      ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300"
      : status === "draft"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <Badge variant="secondary" className={cls}>
      {status}
    </Badge>
  );
}

// ─── Media ───────────────────────────────────────────────────────

export function CmsMediaPanel() {
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({
    filename: "",
    url: "",
    altText: "",
    width: "",
    height: "",
  });
  const [saving, setSaving] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/cms/media");
      const data = await res.json();
      setItems(data.media ?? []);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!form.filename || !form.url) {
      toast.error("Filename and URL are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/cms/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: form.filename,
          url: form.url,
          altText: form.altText || null,
          width: form.width ? Number(form.width) : null,
          height: form.height ? Number(form.height) : null,
          // We don't track actual file size without a binary upload,
          // so we record 0 and infer mimeType from the extension.
          sizeBytes: 0,
          mimeType: guessMime(form.filename),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Media added");
      setAdding(false);
      setForm({ filename: "", url: "", altText: "", width: "", height: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this media entry?")) return;
    const res = await fetch(`/api/super-admin/cms/media/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Delete failed");
      return;
    }
    toast.success("Deleted");
    load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Media library</CardTitle>
          <CardDescription>
            Image and asset URLs that can be referenced from page blocks.
            For binary uploads, store in S3/R2 and paste the URL here.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {adding ? (
          <div className="rounded-lg border bg-muted/30 p-4 mb-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Filename</Label>
              <Input
                value={form.filename}
                onChange={(e) => setForm({ ...form, filename: e.target.value })}
                placeholder="hero-image.png"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">URL</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://…/hero.png"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Alt text</Label>
              <Input
                value={form.altText}
                onChange={(e) => setForm({ ...form, altText: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Width</Label>
              <Input
                type="number"
                value={form.width}
                onChange={(e) => setForm({ ...form, width: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Height</Label>
              <Input
                type="number"
                value={form.height}
                onChange={(e) => setForm({ ...form, height: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={add} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No media yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border bg-card overflow-hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.altText ?? m.filename}
                  className="w-full h-32 object-cover bg-muted"
                />
                <div className="p-2 space-y-1">
                  <p className="text-xs font-medium truncate">{m.filename}</p>
                  {m.altText ? (
                    <p className="text-[10px] text-muted-foreground line-clamp-2">
                      {m.altText}
                    </p>
                  ) : null}
                  <div className="flex justify-between items-center pt-1">
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline"
                    >
                      Open
                    </a>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => remove(m.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return "application/octet-stream";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}