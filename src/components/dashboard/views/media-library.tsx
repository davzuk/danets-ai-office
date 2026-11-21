"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Film, ImageIcon, Images, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface MediaItem {
  id: string;
  kind: "image" | "video" | string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  originalName: string | null;
  source: string;
  createdAt: string;
  createdById?: string | null;
}

type KindFilter = "all" | "image" | "video";

interface Viewer {
  userId: string;
  role: string;
}

// Mirrors MEDIA_LIMITS in src/lib/media.ts; the server checks again.
const IMAGE_MAX = 8 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const ACCEPT = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side pre-check so a 300 MB file isn't uploaded just to be refused. */
function precheck(file: File): string | null {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) return `${file.name}: not an image or video.`;
  const max = isVideo ? VIDEO_MAX : IMAGE_MAX;
  if (file.size > max) return `${file.name}: ${isVideo ? "videos" : "images"} can be up to ${max / (1024 * 1024)} MB.`;
  return null;
}

function useMediaLibrary(kind: KindFilter) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [usage, setUsage] = useState<{ usedMb: number; limitMb: number } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams();
      if (kind !== "all") params.set("kind", kind);
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/media?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load media");
      return data as { items: MediaItem[]; nextCursor: string | null; usage: { usedMb: number; limitMb: number } };
    },
    [kind]
  );

  const reload = useCallback(async () => {
    try {
      const data = await fetchPage(null);
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setUsage(data.usage);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      setLoadingMore(false);
    }
  }

  /** Uploads files; returns the stored items so a picker can select them straight away. */
  async function upload(files: File[]): Promise<MediaItem[]> {
    const ok: File[] = [];
    for (const f of files) {
      const err = precheck(f);
      if (err) toast.error(err);
      else ok.push(f);
    }
    if (ok.length === 0) return [];
    setUploading(true);
    const stored: MediaItem[] = [];
    try {
      // Send in groups of 10 (the server's per-request cap).
      for (let i = 0; i < ok.length; i += 10) {
        const form = new FormData();
        ok.slice(i, i + 10).forEach((f) => form.append("file", f));
        const res = await fetch("/api/media", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || (res.status === 413 ? "That file is too large." : "Upload failed"));
          continue;
        }
        stored.push(...(data.items ?? []));
        for (const e of data.errors ?? []) toast.error(`${e.name}: ${e.error}`);
      }
      if (stored.length) toast.success(stored.length === 1 ? "Uploaded" : `Uploaded ${stored.length} files`);
      await reload();
    } finally {
      setUploading(false);
    }
    return stored;
  }

  return { items, setItems, usage, nextCursor, loading, loadingMore, uploading, reload, loadMore, upload };
}

function UsageBar({ usage }: { usage: { usedMb: number; limitMb: number } | null }) {
  if (!usage) return null;
  if (usage.limitMb <= 0) return <p className="text-xs text-muted-foreground">{usage.usedMb} MB used · unlimited storage</p>;
  const pct = Math.min(100, (usage.usedMb / usage.limitMb) * 100);
  const limit = usage.limitMb >= 1024 ? `${(usage.limitMb / 1024).toFixed(usage.limitMb % 1024 ? 1 : 0)} GB` : `${usage.limitMb} MB`;
  return (
    <div className="space-y-1 min-w-[180px]">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Storage</span>
        <span>
          {usage.usedMb} MB of {limit}
        </span>
      </div>
      <Progress value={pct} className={cn("h-1.5", pct >= 90 && "[&>*]:bg-destructive")} />
    </div>
  );
}

function Thumb({ item }: { item: MediaItem }) {
  if (item.kind === "video") {
    return (
      <div className="relative h-full w-full bg-muted">
        <video src={item.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
        <Film className="absolute bottom-1.5 left-1.5 size-4 text-white drop-shadow" />
      </div>
    );
  }
  return <img src={item.url} alt={item.altText ?? ""} loading="lazy" className="h-full w-full object-cover bg-muted" />;
}

function KindTabs({ value, onChange, lockedTo }: { value: KindFilter; onChange: (k: KindFilter) => void; lockedTo?: "image" | "video" }) {
  if (lockedTo) return null;
  const opts: { key: KindFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "image", label: "Images" },
    { key: "video", label: "Videos" },
  ];
  return (
    <div className="inline-flex rounded-lg border p-0.5 text-sm">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-3 py-1 transition-colors",
            value === o.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface GridProps {
  kind?: "image" | "video";
  /** Picker mode: clicking toggles selection instead of opening details. */
  selection?: { ids: string[]; multiple: boolean; onChange: (items: MediaItem[]) => void; selected: MediaItem[] };
  onOpen?: (item: MediaItem) => void;
  lib: ReturnType<typeof useMediaLibrary>;
  filter: KindFilter;
  onFilterChange: (k: KindFilter) => void;
}

function MediaGrid({ kind, selection, onOpen, lib, filter, onFilterChange }: GridProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const accept = kind ? ACCEPT[kind] : `${ACCEPT.image},${ACCEPT.video}`;

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    const stored = await lib.upload(Array.from(list));
    // In a picker, freshly uploaded files are selected for you.
    if (selection && stored.length) {
      const usable = stored.filter((s) => !kind || s.kind === kind);
      if (usable.length) selection.onChange(selection.multiple ? [...selection.selected, ...usable] : [usable[0]]);
    }
  }

  function toggle(item: MediaItem) {
    if (!selection) return onOpen?.(item);
    const on = selection.ids.includes(item.id);
    if (!selection.multiple) return selection.onChange(on ? [] : [item]);
    selection.onChange(on ? selection.selected.filter((s) => s.id !== item.id) : [...selection.selected, item]);
  }

  return (
    <div
      className={cn("space-y-4 rounded-xl transition-colors", dragging && "ring-2 ring-primary ring-offset-2")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KindTabs value={filter} onChange={onFilterChange} lockedTo={kind} />
          <Button variant="outline" size="icon" className="size-8" onClick={lib.reload} title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <UsageBar usage={lib.usage} />
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={lib.uploading}>
            {lib.uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {lib.uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {lib.loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : lib.items.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-14 text-center text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        >
          <Images className="size-8" />
          <span className="font-medium">No media yet</span>
          <span className="text-xs">
            Drop files here or click to upload. Images up to 8 MB (JPEG, PNG, WebP, GIF), videos up to 100 MB (MP4, MOV, WebM).
          </span>
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {lib.items.map((item) => {
              const selected = selection?.ids.includes(item.id);
              const disabled = !!kind && item.kind !== kind;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(item)}
                  title={item.originalName ?? undefined}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg border text-left transition-all focus-visible:ring-2 focus-visible:ring-primary outline-none",
                    selected ? "ring-2 ring-primary ring-offset-2" : "hover:border-primary/50",
                    disabled && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <Thumb item={item} />
                  {selected && (
                    <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" />
                    </span>
                  )}
                  {!item.altText && item.kind === "image" && (
                    <Badge variant="secondary" className="absolute left-1.5 top-1.5 h-5 px-1.5 text-[10px] opacity-90">
                      No alt text
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
          {lib.nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={lib.loadMore} disabled={lib.loadingMore}>
                {lib.loadingMore && <Loader2 className="size-4 animate-spin" />} Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MediaDetailsDialog({
  item,
  viewer,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: MediaItem | null;
  viewer: Viewer;
  onClose: () => void;
  onSaved: (m: MediaItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [alt, setAlt] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Reset the form when a different item opens (render-time, no effect needed).
  if (item && item.id !== loadedId) {
    setLoadedId(item.id);
    setAlt(item.altText ?? "");
    setConfirmDelete(false);
  }

  if (!item) return null;
  const canDelete = viewer.role === "admin" || item.createdById === viewer.userId;

  async function save() {
    if (!item) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ altText: alt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      onSaved(data.item);
      toast.success("Saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      onDeleted(item.id);
      toast.success("Deleted");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{item.originalName || (item.kind === "video" ? "Video" : "Image")}</DialogTitle>
          <DialogDescription>
            {formatSize(item.sizeBytes)}
            {item.width && item.height ? ` · ${item.width}×${item.height}` : ""} · uploaded{" "}
            {new Date(item.createdAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
          <div className="flex max-h-[50vh] items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {item.kind === "video" ? (
              <video src={item.url} controls playsInline className="max-h-[50vh] w-full" />
            ) : (
              <img src={item.url} alt={item.altText ?? ""} className="max-h-[50vh] w-full object-contain" />
            )}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="media-alt">Alt text</Label>
              <Textarea
                id="media-alt"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                maxLength={1000}
                placeholder="Describe what's in it for people using screen readers, e.g. 'Dentist showing a patient an X-ray'."
                className="min-h-[110px] text-sm"
              />
              <p className="text-xs text-muted-foreground">Sent with posts on platforms that support it (Instagram, LinkedIn).</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(item.url).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy")
                );
              }}
            >
              <Copy className="size-4" /> Copy link
            </Button>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {canDelete ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" onClick={remove} disabled={deleting}>
                  {deleting && <Loader2 className="size-4 animate-spin" />} Delete permanently
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )
          ) : (
            <span />
          )}
          <Button size="sm" onClick={save} disabled={saving || alt === (item.altText ?? "")}>
            {saving && <Loader2 className="size-4 animate-spin" />} Save alt text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sidebar → Media Library. */
export function MediaView({ user }: { user: Viewer }) {
  const [filter, setFilter] = useState<KindFilter>("all");
  const lib = useMediaLibrary(filter);
  const [open, setOpen] = useState<MediaItem | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ImageIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Media Library</h1>
          <p className="text-sm text-muted-foreground">
            Images and videos for your posts and ads. Photos are resized and their location data removed on upload.
          </p>
        </div>
      </div>
      <Card className="p-4 sm:p-5">
        <MediaGrid lib={lib} filter={filter} onFilterChange={setFilter} onOpen={setOpen} />
      </Card>
      <MediaDetailsDialog
        item={open}
        viewer={user}
        onClose={() => setOpen(null)}
        onSaved={(m) => {
          lib.setItems((prev) => prev.map((p) => (p.id === m.id ? { ...p, ...m } : p)));
          setOpen((o) => (o ? { ...o, ...m } : o));
        }}
        onDeleted={(id) => {
          setOpen(null);
          lib.setItems((prev) => prev.filter((p) => p.id !== id));
          lib.reload();
        }}
      />
    </div>
  );
}

/**
 * Pick media from the library (or upload new files) for a post, ad or
 * message. `kind` restricts the choice; `multiple` allows carousels.
 */
export function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
  kind,
  multiple = false,
  title = "Choose media",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (items: MediaItem[]) => void;
  kind?: "image" | "video";
  multiple?: boolean;
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {open && <PickerBody kind={kind} multiple={multiple} title={title} onCancel={() => onOpenChange(false)} onSelect={onSelect} />}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  kind,
  multiple,
  title,
  onCancel,
  onSelect,
}: {
  kind?: "image" | "video";
  multiple: boolean;
  title: string;
  onCancel: () => void;
  onSelect: (items: MediaItem[]) => void;
}) {
  const [filter, setFilter] = useState<KindFilter>(kind ?? "all");
  const lib = useMediaLibrary(filter);
  const [selected, setSelected] = useState<MediaItem[]>([]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {multiple ? "Select one or more files" : "Select a file"}, or upload new ones. You can drop files onto this window.
        </DialogDescription>
      </DialogHeader>
      <MediaGrid
        kind={kind}
        lib={lib}
        filter={filter}
        onFilterChange={setFilter}
        selection={{ ids: selected.map((s) => s.id), selected, multiple, onChange: setSelected }}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={selected.length === 0} onClick={() => onSelect(selected)}>
          {multiple && selected.length > 1 ? `Use ${selected.length} files` : "Use selected"}
        </Button>
      </DialogFooter>
    </>
  );
}
