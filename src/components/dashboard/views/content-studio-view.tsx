"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Eye,
  ImagePlus,
  Languages,
  Loader2,
  MessageSquareQuote,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MediaPickerDialog, type MediaItem } from "@/components/dashboard/views/media-library";
import {
  CONTENT_GOALS,
  CONTENT_PLATFORMS,
  PLATFORM_RULES,
  checkVariant,
  composeText,
  normalizeHashtags,
  platformLength,
  type ContentPlatform,
  type VariantIssue,
} from "@/lib/content/platforms";
import { cn } from "@/lib/utils";
import { PlatformDot, api, errMsg } from "@/components/dashboard/views/content-shared";
import {
  ContentCalendar,
  PostSchedules,
  ScheduleDialog,
  usePublishSettings,
  type PublishSettings,
  type Schedule,
} from "@/components/dashboard/views/content-calendar";
import { ContentAnalytics, type StudioIdea } from "@/components/dashboard/views/content-analytics";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// ─── Types ─────────────────────────────────────────────────────────────

interface Variant {
  id: string;
  platform: ContentPlatform;
  body: string;
  hashtags: string[];
  mediaIds: string[];
  linkUrl: string | null;
  imagePrompt: string | null;
  aiGenerated: boolean;
  editedByHuman: boolean;
  issues: VariantIssue[];
  updatedAt: string;
}

interface Post {
  id: string;
  title: string;
  brief: string;
  goal: string | null;
  toneTweak: string | null;
  campaignTag: string | null;
  status: string;
  createdById: string | null;
  approvedAt: string | null;
  updatedAt: string;
  variants: Variant[];
}

interface PostSummary {
  id: string;
  title: string;
  status: string;
  platforms: string[];
  updatedAt: string;
}

interface Source {
  type: "kb_article" | "lead_question";
  id: string;
  label: string;
  detail: string;
  brief: string;
}

interface Viewer {
  userId: string;
  role: string;
  businessName?: string;
}

type StatusFilter = "active" | "draft" | "in_review" | "approved" | "archived";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  archived: "Archived",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  archived: "bg-muted text-muted-foreground line-through",
};

const GOAL_LABEL: Record<string, string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  leads: "Leads",
  promotion: "Promotion",
};

const LANGUAGES = ["English", "French", "Spanish", "Portuguese", "German", "Arabic", "Yoruba", "Hausa", "Igbo", "Swahili"];

// ─── Helpers ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status] ?? status}</span>;
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── View ──────────────────────────────────────────────────────────────

export function ContentStudioView({ user }: { user: Viewer }) {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [credits, setCredits] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tab, setTab] = useState<"posts" | "calendar" | "analytics">(() => {
    // A one-time hint from a notification (e.g. the weekly insight).
    try {
      const hint = sessionStorage.getItem("studio-tab");
      sessionStorage.removeItem("studio-tab");
      if (hint === "analytics" || hint === "calendar") return hint;
    } catch {}
    return "posts";
  });
  // An idea from the weekly insight, prefilled into a new brief.
  const [idea, setIdea] = useState<{ key: number; value: StudioIdea } | null>(null);
  const { settings } = usePublishSettings();

  const loadList = useCallback(async () => {
    try {
      const qs = filter === "active" ? "" : `?status=${filter}`;
      const data = await api<{ posts: PostSummary[]; credits: typeof credits; canApprove: boolean }>(`/api/content-posts${qs}`);
      setPosts(data.posts);
      setCredits(data.credits);
      setCanApprove(data.canApprove);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoadingList(false);
    }
  }, [filter]);

  useEffect(() => {
    const t = setTimeout(loadList, 0);
    return () => clearTimeout(t);
  }, [loadList]);

  const openPost = useCallback(async (id: string | null) => {
    setSelectedId(id);
    if (!id) return setPost(null);
    setLoadingPost(true);
    try {
      const data = await api<{ post: Post; schedules: Schedule[] }>(`/api/content-posts/${id}`);
      setPost(data.post);
      setSchedules(data.schedules);
    } catch (e) {
      toast.error(errMsg(e));
      setSelectedId(null);
    } finally {
      setLoadingPost(false);
    }
  }, []);

  /** Re-read the open post with its schedules (after scheduling, approving, cancelling). */
  const refreshPost = useCallback(async () => {
    if (!selectedId) return;
    try {
      const data = await api<{ post: Post; schedules: Schedule[] }>(`/api/content-posts/${selectedId}`);
      setPost(data.post);
      setSchedules(data.schedules);
      loadList();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [selectedId, loadList]);

  /** Any server response that returns the post updates the editor and the list. */
  const applyPost = useCallback(
    (p: Post) => {
      setPost(p);
      if (p.id !== selectedId) setSchedules([]);
      setSelectedId(p.id);
      loadList();
      // Approving promotes waiting schedules; pick up their new state.
      api<{ schedules: Schedule[] }>(`/api/content-posts/${p.id}`).then((d) => setSchedules(d.schedules), () => {});
    },
    [loadList, selectedId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Content Studio</h1>
            <p className="text-sm text-muted-foreground">One brief, ready-to-post copy for every platform, in your brand voice.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {credits && credits.limit > 0 && (
            <span className={cn("basis-full text-xs sm:basis-auto", credits.remaining < 10 ? "text-destructive" : "text-muted-foreground")}>
              {credits.remaining.toLocaleString()} of {credits.limit.toLocaleString()} AI credits left this month
            </span>
          )}
          <ToggleGroup type="single" size="sm" variant="outline" value={tab} onValueChange={(v) => v && setTab(v as typeof tab)}>
            <ToggleGroupItem value="posts" className="px-3 text-xs">
              <PenLine className="size-3.5" /> Posts
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar" className="px-3 text-xs">
              <CalendarDays className="size-3.5" /> Calendar
            </ToggleGroupItem>
            <ToggleGroupItem value="analytics" className="px-3 text-xs">
              <BarChart3 className="size-3.5" /> Analytics
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={() => { setTab("posts"); setIdea(null); openPost(null); }}>
            <Plus className="size-4" /> New post
          </Button>
        </div>
      </div>

      {tab === "calendar" ? (
        <ContentCalendar viewer={user} onOpenPost={(id) => { setTab("posts"); openPost(id); }} />
      ) : tab === "analytics" ? (
        <ContentAnalytics
          onOpenIdea={(value) => {
            setIdea({ key: Date.now(), value });
            setTab("posts");
            openPost(null);
          }}
        />
      ) : (
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Post list */}
        <Card className="p-0 overflow-hidden h-fit">
          <div className="border-b p-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
              <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">All active</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="in_review">Waiting for approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {loadingList ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : posts.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No posts here yet.</p>
            ) : (
              posts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openPost(p.id)}
                  className={cn(
                    "w-full border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/50 transition-colors",
                    selectedId === p.id && "bg-primary/5"
                  )}
                >
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <StatusBadge status={p.status} />
                    <div className="flex -space-x-1">
                      {p.platforms.map((pl) => (
                        <PlatformDot key={pl} platform={pl} className="size-4 text-[8px] ring-2 ring-background" />
                      ))}
                    </div>
                    <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(p.updatedAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Editor */}
        <div className="min-w-0">
          {loadingPost ? (
            <Card className="p-6 space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-40" />
            </Card>
          ) : post && selectedId ? (
            <PostEditor
              key={post.id}
              post={post}
              viewer={user}
              canApprove={canApprove}
              schedules={schedules}
              settings={settings}
              onChange={applyPost}
              onScheduled={refreshPost}
              onDeleted={() => { setSelectedId(null); setPost(null); setSchedules([]); loadList(); }}
            />
          ) : (
            <BriefForm key={idea?.key ?? 0} initial={idea?.value} onCreated={(p) => { setIdea(null); applyPost(p); }} />
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── New post ──────────────────────────────────────────────────────────

function BriefForm({ initial, onCreated }: { initial?: StudioIdea; onCreated: (p: Post) => void }) {
  const [brief, setBrief] = useState(initial?.brief ?? "");
  const [platforms, setPlatforms] = useState<ContentPlatform[]>(initial?.platforms.length ? initial.platforms : ["facebook", "instagram", "linkedin"]);
  const [goal, setGoal] = useState<string>(initial?.goal ?? "none");
  const [toneTweak, setToneTweak] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [campaignTag, setCampaignTag] = useState("");
  const [source, setSource] = useState<{ type: Source["type"]; id: string } | null>(null);
  const [pickSource, setPickSource] = useState(false);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const data = await api<{ post: Post }>("/api/content-posts", {
        method: "POST",
        body: JSON.stringify({
          brief,
          platforms,
          goal: goal === "none" ? null : goal,
          toneTweak: toneTweak || null,
          linkUrl: linkUrl || null,
          campaignTag: campaignTag || null,
          sourceType: source?.type ?? null,
          sourceId: source?.id ?? null,
        }),
      });
      toast.success("Posts drafted. Review them before sending for approval.");
      onCreated(data.post);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (p: ContentPlatform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">What do you want to post about?</h2>
          <p className="text-sm text-muted-foreground">Describe the idea, news or offer. The AI only uses facts from your brand voice and knowledge base.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPickSource(true)}>
          <BookOpen className="size-4" /> Start from…
        </Button>
      </div>

      <div className="space-y-1.5">
        <Textarea
          value={brief}
          onChange={(e) => {
            setBrief(e.target.value);
            if (!e.target.value) setSource(null);
          }}
          maxLength={4000}
          placeholder="e.g. We now open on Saturdays from 9 to 2. Invite families who can't make weekday appointments to book."
          className="min-h-[130px]"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{source ? `Repurposing a ${source.type === "kb_article" ? "knowledge base article" : "lead question"}` : " "}</span>
          <span>{brief.length.toLocaleString()} / 4,000</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Platforms</Label>
        <div className="flex flex-wrap gap-2">
          {CONTENT_PLATFORMS.map((p) => (
            <label
              key={p}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                platforms.includes(p) ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              )}
            >
              <Checkbox checked={platforms.includes(p)} onCheckedChange={() => toggle(p)} />
              <PlatformDot platform={p} />
              {PLATFORM_RULES[p].label}
              {!PLATFORM_RULES[p].autoPublish && <span className="text-[10px] text-muted-foreground">(copy & post)</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Goal</Label>
          <Select value={goal} onValueChange={setGoal}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No specific goal</SelectItem>
              {CONTENT_GOALS.map((g) => (
                <SelectItem key={g} value={g}>
                  {GOAL_LABEL[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tone-tweak">Tone tweak (optional)</Label>
          <Input id="tone-tweak" value={toneTweak} onChange={(e) => setToneTweak(e.target.value)} maxLength={200} placeholder="e.g. more playful, urgent, celebratory" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="link-url">Link (optional)</Label>
          <Input id="link-url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" inputMode="url" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="campaign">Campaign tag (optional)</Label>
          <Input id="campaign" value={campaignTag} onChange={(e) => setCampaignTag(e.target.value)} maxLength={80} placeholder="e.g. Saturday opening" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {busy && <span className="text-xs text-muted-foreground">Writing {platforms.length} posts… this takes up to a minute.</span>}
        <Button onClick={generate} disabled={busy || brief.trim().length < 10 || platforms.length === 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate posts
        </Button>
      </div>

      <SourcePicker
        open={pickSource}
        onOpenChange={setPickSource}
        onPick={(s) => {
          setBrief(s.brief);
          setSource({ type: s.type, id: s.id });
          setPickSource(false);
        }}
      />
    </Card>
  );
}

function SourcePicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (s: Source) => void }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const data = await api<{ sources: Source[] }>(`/api/content-posts/sources${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        setSources(data.sources);
      } catch (e) {
        toast.error(errMsg(e));
        setSources([]);
      }
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Repurpose into posts</DialogTitle>
          <DialogDescription>Pick a knowledge base article or a question a lead asked. It becomes the brief, which you can still edit.</DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
        <div className="max-h-[50vh] overflow-y-auto divide-y rounded-lg border">
          {sources === null ? (
            <div className="p-4 text-center">
              <Loader2 className="mx-auto size-4 animate-spin" />
            </div>
          ) : sources.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Nothing found. Add knowledge base articles first.</p>
          ) : (
            sources.map((s) => (
              <button key={`${s.type}:${s.id}`} type="button" onClick={() => onPick(s)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/50">
                {s.type === "kb_article" ? <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" /> : <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.detail}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Editor ────────────────────────────────────────────────────────────

function PostEditor({
  post,
  viewer,
  canApprove,
  schedules,
  settings,
  onChange,
  onScheduled,
  onDeleted,
}: {
  post: Post;
  viewer: Viewer;
  canApprove: boolean;
  schedules: Schedule[];
  settings: PublishSettings | null;
  onChange: (p: Post) => void;
  onScheduled: () => void;
  onDeleted: () => void;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);
  const [brief, setBrief] = useState(post.brief);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [media, setMedia] = useState<Record<string, MediaItem>>({});

  const missing = CONTENT_PLATFORMS.filter((p) => !post.variants.some((v) => v.platform === p));
  const errors = post.variants.filter((v) => v.issues.some((i) => i.severity === "error"));
  const canDelete = viewer.role === "admin" || post.createdById === viewer.userId;

  // Thumbnails for attached media.
  const mediaKey = post.variants.flatMap((v) => v.mediaIds).join(",");
  useEffect(() => {
    const ids = mediaKey.split(",").filter((id) => id);
    if (!ids.length) return;
    const t = setTimeout(async () => {
      try {
        const data = await api<{ items: MediaItem[] }>(`/api/media?ids=${ids.join(",")}`);
        setMedia((m) => ({ ...m, ...Object.fromEntries(data.items.map((i) => [i.id, i])) }));
      } catch {
        // thumbnails are cosmetic
      }
    }, 0);
    return () => clearTimeout(t);
  }, [mediaKey]);

  async function run(label: string, fn: () => Promise<{ post: Post }>, success?: string) {
    setBusy(label);
    try {
      const data = await fn();
      onChange(data.post);
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (status: string, success: string) =>
    run(status, () => api(`/api/content-posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ status }) }), success);

  async function remove() {
    setBusy("delete");
    try {
      await api(`/api/content-posts/${post.id}`, { method: "DELETE" });
      toast.success("Post deleted");
      onDeleted();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold">{post.title}</h2>
              <StatusBadge status={post.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {post.goal ? `${GOAL_LABEL[post.goal] ?? post.goal} · ` : ""}
              {post.campaignTag ? `${post.campaignTag} · ` : ""}
              updated {timeAgo(post.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {post.status === "draft" && (
              <Button size="sm" onClick={() => setStatus("in_review", "Sent for approval")} disabled={!!busy || errors.length > 0 || post.variants.length === 0}>
                {busy === "in_review" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send for approval
              </Button>
            )}
            {(post.status === "draft" || post.status === "in_review") && canApprove && (
              <Button size="sm" variant={post.status === "in_review" ? "default" : "outline"} onClick={() => setStatus("approved", "Approved")} disabled={!!busy || errors.length > 0 || post.variants.length === 0}>
                {busy === "approved" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Approve
              </Button>
            )}
            {(post.status === "in_review" || post.status === "approved" || post.status === "archived") && (
              <Button size="sm" variant="outline" onClick={() => setStatus("draft", "Moved back to drafts")} disabled={!!busy}>
                <Undo2 className="size-4" /> Back to draft
              </Button>
            )}
            {post.status !== "archived" && post.variants.length > 0 && (
              <Button size="sm" variant={post.status === "approved" ? "default" : "outline"} onClick={() => setScheduling(true)} disabled={!!busy || errors.length === post.variants.length}>
                <CalendarClock className="size-4" /> Schedule
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={!!busy}>
                  More <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => run("regen", () => api(`/api/content-posts/${post.id}/generate`, { method: "POST", body: "{}" }), "Rewritten from the brief")}>
                  <RefreshCw className="size-4" /> Regenerate all
                </DropdownMenuItem>
                {post.status !== "archived" && (
                  <DropdownMenuItem onClick={() => setStatus("archived", "Archived")}>
                    <Archive className="size-4" /> Archive
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {editingBrief ? (
          <div className="space-y-2">
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} className="min-h-[100px] text-sm" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setBrief(post.brief); setEditingBrief(false); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={brief.trim().length < 10 || !!busy}
                onClick={() => run("brief", () => api(`/api/content-posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ brief }) }), "Brief saved").then(() => setEditingBrief(false))}
              >
                Save brief
              </Button>
              <Button
                size="sm"
                disabled={brief.trim().length < 10 || !!busy}
                onClick={() =>
                  run("regen", async () => {
                    await api(`/api/content-posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ brief }) });
                    return api(`/api/content-posts/${post.id}/generate`, { method: "POST", body: "{}" });
                  }, "Rewritten from the new brief").then(() => setEditingBrief(false))
                }
              >
                <Sparkles className="size-4" /> Save and regenerate
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingBrief(true)} className="group w-full rounded-lg bg-muted/40 p-3 text-left text-sm text-muted-foreground hover:bg-muted/70">
            <span className="line-clamp-3 whitespace-pre-wrap">{post.brief}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100">
              <PenLine className="size-3" /> Edit brief
            </span>
          </button>
        )}
        {busy === "regen" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Rewriting every platform from the brief…
          </p>
        )}
        <PostSchedules schedules={schedules} tz={settings?.timezone ?? "UTC"} viewer={viewer} onChanged={onScheduled} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {post.variants.map((v) => (
          <VariantCard key={`${v.id}:${v.updatedAt}`} post={post} variant={v} media={media} businessName={viewer.businessName ?? ""} onChange={onChange} />
        ))}
      </div>

      {missing.length > 0 && post.status !== "archived" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Add a platform:</span>
          {missing.map((p) => (
            <Button
              key={p}
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => run(`add:${p}`, () => api(`/api/content-posts/${post.id}/generate`, { method: "POST", body: JSON.stringify({ platforms: [p] }) }), `${PLATFORM_RULES[p].label} copy added`)}
            >
              {busy === `add:${p}` ? <Loader2 className="size-3.5 animate-spin" /> : <PlatformDot platform={p} className="size-4" />}
              {PLATFORM_RULES[p].label}
            </Button>
          ))}
        </div>
      )}

      <ScheduleDialog open={scheduling} onOpenChange={setScheduling} post={post} settings={settings} viewer={viewer} onScheduled={onScheduled} />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>The brief and every platform&apos;s copy are deleted permanently. Attached media stays in the library.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy === "delete"}>
              {busy === "delete" && <Loader2 className="size-4 animate-spin" />} Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── One platform ──────────────────────────────────────────────────────

function VariantCard({
  post,
  variant,
  media,
  businessName,
  onChange,
}: {
  post: Post;
  variant: Variant;
  media: Record<string, MediaItem>;
  businessName: string;
  onChange: (p: Post) => void;
}) {
  const rule = PLATFORM_RULES[variant.platform];
  const [body, setBody] = useState(variant.body);
  const [tags, setTags] = useState(variant.hashtags.map((t) => `#${t}`).join(" "));
  const [linkUrl, setLinkUrl] = useState(variant.linkUrl ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [instruction, setInstruction] = useState("");

  const hashtags = useMemo(() => normalizeHashtags(tags.split(/[\s,]+/)), [tags]);
  const dirty = body !== variant.body || hashtags.join(" ") !== variant.hashtags.join(" ") || (linkUrl || null) !== (variant.linkUrl || null);
  const content = { body, hashtags, linkUrl: rule.clickableLinks ? linkUrl || null : null };
  const length = platformLength(variant.platform, composeText(variant.platform, content));
  // Live checks while editing; the server's (which include banned phrases) once saved.
  const issues = dirty ? checkVariant(variant.platform, content) : variant.issues;
  const over = length > rule.maxChars;

  async function call(label: string, url: string, init: RequestInit, success?: string) {
    setBusy(label);
    try {
      const data = await api<{ post: Post }>(url, init);
      onChange(data.post);
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const base = `/api/content-posts/${post.id}/variants/${variant.platform}`;
  const save = (extra: Record<string, unknown> = {}) =>
    call("save", base, { method: "PATCH", body: JSON.stringify({ body, hashtags, linkUrl: rule.clickableLinks ? linkUrl || null : undefined, ...extra }) }, "Saved");
  const rewrite = (action: string, extra: Record<string, unknown> = {}) =>
    call(action, `${base}/rewrite`, { method: "POST", body: JSON.stringify({ action, ...extra }) });

  const attached = variant.mediaIds.map((id) => media[id]).filter(Boolean);

  return (
    <Card className={cn("p-4 space-y-3", busy && busy !== "save" && "opacity-70")}>
      <div className="flex items-center gap-2">
        <PlatformDot platform={variant.platform} />
        <span className="font-medium">{rule.label}</span>
        {variant.editedByHuman ? (
          <Badge variant="outline" className="h-5 text-[10px]">Edited</Badge>
        ) : variant.aiGenerated ? (
          <Badge variant="outline" className="h-5 text-[10px]">AI draft</Badge>
        ) : null}
        <span className={cn("ml-auto font-mono text-xs tabular-nums", over ? "text-destructive font-semibold" : length > rule.idealChars ? "text-amber-600" : "text-muted-foreground")}>
          {length.toLocaleString()} / {rule.maxChars.toLocaleString()}
        </span>
        <Button size="icon" variant="ghost" className="size-7" onClick={() => setPreview((p) => !p)} title="Preview">
          <Eye className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={!!busy}>
              {busy && busy !== "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => rewrite("regenerate")}>
              <RefreshCw className="size-4" /> Regenerate this one
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => rewrite("shorter")}>Shorter</DropdownMenuItem>
            <DropdownMenuItem onClick={() => rewrite("add_cta")}>Add a call to action</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages className="size-4" /> Translate to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {LANGUAGES.map((l) => (
                  <DropdownMenuItem key={l} onClick={() => rewrite("translate", { locale: l })}>
                    {l}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => setCustomOpen(true)}>
              <PenLine className="size-4" /> Custom edit…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => call("remove", base, { method: "DELETE" }, `${rule.label} removed`)}>
              <X className="size-4" /> Remove {rule.label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {preview ? (
        <PhonePreview platform={variant.platform} businessName={businessName} text={composeText(variant.platform, content)} media={attached} />
      ) : (
        <>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[180px] text-sm leading-relaxed" aria-label={`${rule.label} post`} />
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#hashtags" className="h-8 text-sm text-primary" aria-label="Hashtags" />
          {rule.clickableLinks && !rule.linkInline && (
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Link (attached to the post)" className="h-8 text-sm" />
          )}
          {rule.linkInline && (
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Link (added to the post, counts as 23 characters)" className="h-8 text-sm" />
          )}
        </>
      )}

      {issues.length > 0 && (
        <ul className="space-y-1">
          {issues.map((i, n) => (
            <li key={n} className={cn("flex items-start gap-1.5 text-xs", i.severity === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {i.message}
            </li>
          ))}
        </ul>
      )}

      {/* Media */}
      <div className="flex flex-wrap items-center gap-2">
        {attached.map((m) => (
          <div key={m.id} className="relative size-14 overflow-hidden rounded-md border">
            {m.kind === "video" ? (
              <video src={m.url} muted preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <img src={m.url} alt={m.altText ?? ""} className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              aria-label="Remove media"
              onClick={() => call("media", base, { method: "PATCH", body: JSON.stringify({ mediaIds: variant.mediaIds.filter((id) => id !== m.id) }) })}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-8" onClick={() => setPicking(true)} disabled={!!busy}>
          <ImagePlus className="size-4" /> {attached.length ? "Change media" : variant.platform === "tiktok" ? "Attach video" : "Attach media"}
        </Button>
      </div>
      {variant.imagePrompt && !attached.length && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Suggested visual:</span> {variant.imagePrompt}
        </p>
      )}

      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setBody(variant.body); setTags(variant.hashtags.map((t) => `#${t}`).join(" ")); setLinkUrl(variant.linkUrl ?? ""); }}>
            Discard
          </Button>
          <Button size="sm" onClick={() => save()} disabled={busy === "save"}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </div>
      )}

      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        kind={variant.platform === "tiktok" ? "video" : undefined}
        multiple={variant.platform !== "tiktok"}
        title={`Media for ${rule.label}`}
        onSelect={(items) => {
          setPicking(false);
          call("media", base, { method: "PATCH", body: JSON.stringify({ mediaIds: items.map((i) => i.id) }) }, "Media attached");
        }}
      />

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit the {rule.label} post with AI</DialogTitle>
            <DialogDescription>Say what to change, e.g. &quot;mention the free parking&quot; or &quot;start with a question&quot;.</DialogDescription>
          </DialogHeader>
          <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={500} className="min-h-[90px]" />
          <DialogFooter>
            <Button
              disabled={instruction.trim().length < 3}
              onClick={() => {
                setCustomOpen(false);
                rewrite("custom", { instruction });
                setInstruction("");
              }}
            >
              <Wand2 className="size-4" /> Rewrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PhonePreview({ platform, businessName, text, media }: { platform: ContentPlatform; businessName: string; text: string; media: MediaItem[] }) {
  const first = media[0];
  const parts = text.split(/(#[\p{L}\p{N}_]+|https?:\/\/\S+)/u);
  const visual = first ? (
    first.kind === "video" ? (
      <video src={first.url} muted controls playsInline className="aspect-square w-full bg-black object-cover" />
    ) : (
      <img src={first.url} alt={first.altText ?? ""} className="aspect-square w-full object-cover" />
    )
  ) : (
    <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">No image attached</div>
  );
  const caption = (
    <p className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-snug">
      {platform === "instagram" && <span className="mr-1 font-semibold">{businessName.toLowerCase().replace(/\s+/g, "") || "yourbrand"}</span>}
      {parts.map((p, i) => (/^(#|https?:)/.test(p) ? <span key={i} className="text-[#1d6ee8]">{p}</span> : <span key={i}>{p}</span>))}
    </p>
  );
  return (
    <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/80 bg-background shadow-lg">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="size-7 rounded-full bg-primary/20" />
        <div className="text-[13px] font-semibold leading-tight">
          {businessName || "Your business"}
          <div className="text-[10px] font-normal text-muted-foreground">{PLATFORM_RULES[platform].label} · Preview</div>
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {platform === "instagram" || platform === "tiktok" ? (
          <>
            {visual}
            {caption}
          </>
        ) : (
          <>
            {caption}
            {first && visual}
          </>
        )}
        {media.length > 1 && <p className="px-3 pb-2 text-[11px] text-muted-foreground">+{media.length - 1} more</p>}
      </div>
    </div>
  );
}
