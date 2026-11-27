"use client";

// SEO (Phase 3, workstream X). The Google Business Profile reviews inbox:
// new reviews, AI-drafted replies in the brand voice, the approval policy,
// and replies posted back to Google.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Loader2, MapPin, MessageSquareReply, RefreshCw, Send, ShieldCheck, Sparkles, Star, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Review {
  id: string;
  locationId: string;
  locationTitle: string | null;
  reviewerName: string | null;
  reviewerPhoto: string | null;
  anonymous: boolean;
  starRating: number;
  comment: string | null;
  createdAt: string;
  replyText: string | null;
  repliedAt: string | null;
  replyState: string | null;
  replyStatus: "none" | "draft" | "pending_approval" | "posted" | "failed";
  draftReply: string | null;
  draftedByName: string | null;
  replyError: string | null;
  autoReplied: boolean;
}

interface LocationSummary {
  id: string;
  title: string;
  status: string;
  error: string | null;
  averageRating: number | null;
  totalReviewCount: number | null;
  reviewsSyncedAt: string | null;
  reviewsError: string | null;
  reviewUri: string | null;
  mapsUri: string | null;
}

interface ReviewsData {
  locations: LocationSummary[];
  reviews: Review[];
  page: number;
  pageSize: number;
  total: number;
  counts: { unreplied: number; needsApproval: number; last30: number };
  requests: { sent30: number; clicked30: number };
  settings: { autoReplyNoText: boolean };
  canEdit: boolean;
}

type Filter = "all" | "unreplied" | "needs_approval" | "low";

async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={n > 0 ? `${n} out of 5 stars` : "No rating"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
      ))}
    </span>
  );
}

export function SeoReviewsView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [locationId, setLocationId] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReviewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ filter, page: String(page), ...(locationId !== "all" ? { locationId } : {}) });
    try {
      setData(await api<ReviewsData>(`/api/seo/reviews?${q}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load reviews.");
    }
  }, [filter, locationId, page]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const replace = (r: Review) => setData((d) => (d ? { ...d, reviews: d.reviews.map((x) => (x.id === r.id ? r : x)) } : d));

  const syncNow = async () => {
    setSyncing(true);
    try {
      await api("/api/seo/reviews/sync", { method: "POST" });
      toast.success("Fetching new reviews from Google. This takes a minute.");
      setTimeout(load, 8000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the sync.");
    } finally {
      setSyncing(false);
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  if (!data.locations.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <MapPin className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No Business Profile location yet</p>
          <p className="max-w-md text-sm text-muted-foreground">Add your Google Business Profile location in the Setup tab. Reviews then appear here every couple of hours, ready to reply to.</p>
        </CardContent>
      </Card>
    );
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reviews</h1>
          <p className="text-sm text-muted-foreground">Your Google reviews, with replies drafted in your brand voice. Replies post to Google under your Business Profile.</p>
        </div>
        {data.canEdit && (
          <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Check for new reviews
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.locations.length === 1 ? (
          <Tile label="Rating" value={data.locations[0].averageRating ? data.locations[0].averageRating.toFixed(1) : "–"} sub={data.locations[0].totalReviewCount != null ? `${data.locations[0].totalReviewCount} reviews on Google` : "Not synced yet"} />
        ) : (
          <Tile label="Locations" value={String(data.locations.length)} sub={`${data.locations.reduce((n, l) => n + (l.totalReviewCount ?? 0), 0)} reviews on Google`} />
        )}
        <Tile label="New in 30 days" value={String(data.counts.last30)} sub="reviews" />
        <Tile label="Without a reply" value={String(data.counts.unreplied)} sub={data.counts.needsApproval ? `${data.counts.needsApproval} waiting for approval` : "Replying helps your ranking"} warn={data.counts.unreplied > 0} />
        <Tile label="Review requests" value={String(data.requests.sent30)} sub={data.requests.sent30 ? `${data.requests.clicked30} opened the link (30 days)` : "Set one up in Automations"} />
      </div>

      {data.locations.map(
        (l) =>
          (l.reviewsError || l.status !== "active") && (
            <p key={l.id} className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <b>{l.title}:</b> {l.status !== "active" ? l.error : l.reviewsError}
              </span>
            </p>
          )
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border p-0.5">
          {(
            [
              ["all", "All"],
              ["unreplied", "No reply"],
              ["needs_approval", "Needs approval"],
              ["low", "1-2 stars"],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
            >
              {label}
              {f === "needs_approval" && data.counts.needsApproval > 0 && <Badge className="ml-1.5 h-4 px-1 text-[10px]">{data.counts.needsApproval}</Badge>}
            </Button>
          ))}
        </div>
        {data.locations.length > 1 && (
          <Select
            value={locationId}
            onValueChange={(v) => {
              setLocationId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {data.locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {data.reviews.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filter === "all" ? (data.locations.some((l) => l.reviewsSyncedAt) ? "No reviews yet." : "Reviews haven't been fetched yet. They arrive within a couple of hours of adding a location.") : "Nothing here."}
        </p>
      ) : (
        <div className="space-y-3">
          {data.reviews.map((r) => (
            <ReviewCard key={r.id} review={r} canApprove={data.canEdit} showLocation={data.locations.length > 1} onChange={replace} onReload={load} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      {data.canEdit && <ReviewSettingsCard settings={data.settings} onSaved={(s) => setData((d) => (d ? { ...d, settings: s } : d))} />}
    </div>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold", warn && "text-amber-600 dark:text-amber-400")}>{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

const REPLY_STATE: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  PENDING: { label: "Google is checking it", icon: Clock, className: "text-sky-700 dark:text-sky-400" },
  REJECTED: { label: "Google rejected this reply", icon: XCircle, className: "text-destructive" },
  APPROVED: { label: "Live on Google", icon: CheckCircle2, className: "text-emerald-700 dark:text-emerald-400" },
};

function ReviewCard({ review: r, canApprove, showLocation, onChange, onReload }: { review: Review; canApprove: boolean; showLocation: boolean; onChange: (r: Review) => void; onReload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.draftReply ?? "");
  const [busy, setBusy] = useState<null | "draft" | "post" | "approve" | "discard">(null);

  const openEditor = (initial: string) => {
    setText(initial);
    setEditing(true);
  };

  const draft = async () => {
    setBusy("draft");
    try {
      const d = await api<{ review: Review; warnings: string[] }>(`/api/seo/reviews/${r.id}/draft`, { method: "POST" });
      onChange(d.review);
      openEditor(d.review.draftReply ?? "");
      for (const w of d.warnings) toast.warning(w);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft a reply.");
    } finally {
      setBusy(null);
    }
  };

  const post = async () => {
    setBusy("post");
    try {
      const d = await api<{ review: Review; posted: boolean }>(`/api/seo/reviews/${r.id}/reply`, { method: "POST", json: { text } });
      onChange(d.review);
      setEditing(false);
      toast.success(d.posted ? "Reply posted to Google." : "Sent for approval. An admin will post it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post the reply.");
      onReload();
    } finally {
      setBusy(null);
    }
  };

  const approve = async (edited?: string) => {
    setBusy("approve");
    try {
      const d = await api<{ review: Review }>(`/api/seo/reviews/${r.id}/approve`, { method: "POST", json: edited ? { text: edited } : {} });
      onChange(d.review);
      setEditing(false);
      toast.success("Approved and posted to Google.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post the reply.");
      onReload();
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("discard");
    try {
      const d = await api<{ review: Review }>(`/api/seo/reviews/${r.id}/reply`, { method: "DELETE" });
      onChange(d.review);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't discard it.");
    } finally {
      setBusy(null);
    }
  };

  const state = r.replyText && r.replyState ? REPLY_STATE[r.replyState] : null;
  const waiting = r.replyStatus === "pending_approval";
  const hasDraft = !!r.draftReply && (r.replyStatus === "draft" || r.replyStatus === "failed");

  return (
    <Card className={cn(r.starRating > 0 && r.starRating <= 2 && !r.replyText && "border-red-300 dark:border-red-500/40")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          {r.reviewerPhoto ? (
            <img src={r.reviewerPhoto} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">{(r.reviewerName ?? "?").slice(0, 1).toUpperCase()}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{r.anonymous ? "A Google user" : (r.reviewerName ?? "A Google user")}</span>
              <Stars n={r.starRating} />
              <span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
              {showLocation && r.locationTitle && (
                <Badge variant="outline" className="text-[10px]">
                  {r.locationTitle}
                </Badge>
              )}
            </div>
            {r.comment ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.comment}</p> : <p className="mt-1 text-sm italic text-muted-foreground">Rating only, no text.</p>}
          </div>
        </div>

        {r.replyText && !editing && (
          <div className="ml-12 rounded-md border bg-muted/40 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <MessageSquareReply className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">Your reply</span>
              <span className="text-muted-foreground">{fmtDate(r.repliedAt)}</span>
              {r.autoReplied && <Badge variant="secondary" className="text-[10px]">Auto-reply</Badge>}
              {state && (
                <span className={cn("inline-flex items-center gap-1", state.className)}>
                  <state.icon className="h-3 w-3" />
                  {state.label}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{r.replyText}</p>
          </div>
        )}

        {waiting && !editing && (
          <div className="ml-12 rounded-md border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Waiting for approval{r.draftedByName ? ` · written by ${r.draftedByName}` : ""}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{r.draftReply}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {canApprove && (
                <>
                  <Button size="sm" className="h-7" onClick={() => approve()} disabled={!!busy}>
                    {busy === "approve" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Approve and post
                  </Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => openEditor(r.draftReply ?? "")} disabled={!!busy}>
                    Edit
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" className="h-7" onClick={discard} disabled={!!busy}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Discard
              </Button>
            </div>
          </div>
        )}

        {r.replyStatus === "failed" && r.replyError && !editing && (
          <p className="ml-12 flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {r.replyError}
          </p>
        )}

        {editing ? (
          <div className="ml-12 space-y-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} placeholder="Write your reply…" />
            <div className="flex flex-wrap items-center gap-2">
              {waiting && canApprove ? (
                <Button size="sm" onClick={() => approve(text)} disabled={!!busy || text.trim().length < 2}>
                  {busy === "approve" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Approve and post
                </Button>
              ) : (
                <Button size="sm" onClick={post} disabled={!!busy || text.trim().length < 2}>
                  {busy === "post" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                  {r.replyText ? "Update reply" : "Post reply"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={draft} disabled={!!busy}>
                {busy === "draft" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                {text ? "Draft again" : "Draft with AI"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={!!busy}>
                Cancel
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">{text.length} / 4000</span>
            </div>
            <p className="text-xs text-muted-foreground">Replies are public on Google. Don&apos;t include the customer&apos;s private details.</p>
          </div>
        ) : (
          !waiting && (
            <div className="ml-12 flex flex-wrap gap-2">
              {hasDraft ? (
                <>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => openEditor(r.draftReply ?? "")}>
                    Continue draft
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={discard} disabled={!!busy}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Discard draft
                  </Button>
                </>
              ) : r.replyText ? (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => openEditor(r.replyText ?? "")}>
                  Edit reply
                </Button>
              ) : (
                <>
                  <Button size="sm" className="h-7" onClick={draft} disabled={!!busy}>
                    {busy === "draft" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Draft reply
                  </Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => openEditor("")}>
                    Write my own
                  </Button>
                </>
              )}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

function ReviewSettingsCard({ settings, onSaved }: { settings: { autoReplyNoText: boolean }; onSaved: (s: { autoReplyNoText: boolean }) => void }) {
  const [saving, setSaving] = useState(false);
  const toggle = async (v: boolean) => {
    setSaving(true);
    try {
      const d = await api<{ settings: { autoReplyNoText: boolean } }>("/api/seo/reviews/settings", { method: "PATCH", json: { autoReplyNoText: v } });
      onSaved(d.settings);
      toast.success(v ? "Automatic thank-yous are on." : "Automatic thank-yous are off.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review settings</CardTitle>
        <CardDescription>
          Ask happy customers for reviews with the &quot;Ask for a Google Review&quot; action in Automations (for example after a completed booking). Everyone gets the same link, as Google requires.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="auto-reply" className="text-sm font-medium">
              Thank 4-5 star reviews that have no text automatically
            </Label>
            <p className="text-xs text-muted-foreground">A short thank-you is posted for you. Reviews with text always wait for a person. If every post needs approval, these wait too.</p>
          </div>
          <Switch id="auto-reply" checked={settings.autoReplyNoText} disabled={saving} onCheckedChange={toggle} />
        </div>
      </CardContent>
    </Card>
  );
}

