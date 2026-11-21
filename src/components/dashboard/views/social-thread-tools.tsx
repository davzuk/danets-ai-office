"use client";

// Social inbox pieces used by Conversations: channel badges, the reply
// composer (with Meta's 24-hour window), takeover / create-lead actions and
// per-message extras (team sender, drafts, failed sends, comment labels).

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  EyeOff,
  Eye,
  Facebook,
  Globe,
  Hand,
  Instagram,
  Loader2,
  Lock,
  MessageCircle,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type Channel = "widget" | "messenger" | "instagram_dm" | "facebook_comment" | "instagram_comment";

export const CHANNEL_FILTERS: { key: "all" | "social" | Channel; label: string }[] = [
  { key: "all", label: "All channels" },
  { key: "widget", label: "Website" },
  { key: "social", label: "All social" },
  { key: "messenger", label: "Messenger" },
  { key: "instagram_dm", label: "Instagram DMs" },
  { key: "facebook_comment", label: "Facebook comments" },
  { key: "instagram_comment", label: "Instagram comments" },
];

const CHANNEL_META: Record<Channel, { label: string; icon: typeof Globe; className: string }> = {
  widget: { label: "Website", icon: Globe, className: "bg-secondary text-secondary-foreground" },
  messenger: { label: "Messenger", icon: Facebook, className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  instagram_dm: { label: "Instagram", icon: Instagram, className: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
  facebook_comment: { label: "FB comment", icon: MessageCircle, className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  instagram_comment: { label: "IG comment", icon: MessageCircle, className: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
};

export const isCommentChannel = (c: string) => c === "facebook_comment" || c === "instagram_comment";
export const isSocialChannel = (c: string | undefined) => !!c && c !== "widget";

export function ChannelBadge({ channel }: { channel?: string }) {
  const meta = CHANNEL_META[(channel as Channel) ?? "widget"] ?? CHANNEL_META.widget;
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("text-[10px] h-4 px-1.5 gap-1 border-transparent", meta.className)}>
      <Icon size={9} /> {meta.label}
    </Badge>
  );
}

export interface SocialMessage {
  id: string;
  role: string;
  content: string;
  sentByUserId?: string | null;
  deliveryStatus?: string | null;
  meta?: string | null;
}

function parseMeta(meta: string | null | undefined): Record<string, unknown> {
  try {
    const v = meta ? JSON.parse(meta) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const LABEL_STYLE: Record<string, string> = {
  buying_intent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  question: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  complaint: "bg-destructive/15 text-destructive",
  spam: "bg-muted text-muted-foreground",
  other: "bg-muted text-muted-foreground",
};

/** Who sent an outbound message, shown above the bubble's time. */
export function senderLabel(m: SocialMessage, senders: Record<string, string>): string | null {
  if (m.role !== "assistant") return null;
  if (m.sentByUserId) return senders[m.sentByUserId] ?? "Team";
  if (parseMeta(m.meta).source === "meta_inbox") return "Team (via Meta)";
  return null;
}

/** Extras under a social message: draft actions, failure, comment label, hide. */
export function SocialMessageExtras({
  message,
  sessionId,
  comment,
  onChanged,
}: {
  message: SocialMessage;
  sessionId: string;
  comment: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const meta = parseMeta(message.meta);

  async function run(fn: () => Promise<Response>, ok: string) {
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      toast.success(ok);
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (message.deliveryStatus === "draft") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
          <Bot size={9} /> AI draft, not sent
        </Badge>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                fetch(`/api/conversations/${sessionId}/reply`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ text: message.content, draftId: message.id }),
                }),
              "Reply sent"
            )
          }
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={() => run(() => fetch(`/api/conversations/${sessionId}/messages/${message.id}`, { method: "DELETE" }), "Draft discarded")}
        >
          <Trash2 size={11} /> Discard
        </Button>
      </div>
    );
  }

  return (
    <>
      {message.deliveryStatus === "failed" && (
        <div className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Not delivered{meta.error ? `: ${String(meta.error)}` : ""}
        </div>
      )}
      {meta.privateReply === true && <div className="mt-1 text-[10px] opacity-70">Sent as a private message</div>}
      {comment && message.role === "user" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {typeof meta.classification === "string" && (
            <Badge variant="secondary" className={cn("text-[10px] h-4 px-1.5 border-transparent", LABEL_STYLE[meta.classification])}>
              {meta.classification.replace("_", " ")}
            </Badge>
          )}
          {meta.hidden === true && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              hidden
            </Badge>
          )}
          <button
            className="inline-flex items-center gap-1 text-[10px] underline-offset-2 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  fetch(`/api/conversations/${sessionId}/messages/${message.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ hidden: meta.hidden !== true }),
                  }),
                meta.hidden === true ? "Comment visible again" : "Comment hidden"
              )
            }
          >
            {meta.hidden === true ? <Eye size={10} /> : <EyeOff size={10} />}
            {meta.hidden === true ? "Unhide" : "Hide"}
          </button>
        </div>
      )}
    </>
  );
}

export interface ReplyWindow {
  state: "open" | "human_agent" | "closed" | string;
  closesAt: string | null;
}

function hoursLeft(iso: string | null) {
  if (!iso) return null;
  const h = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`;
}

/** Reply box for social threads. */
export function SocialComposer({
  sessionId,
  channel,
  window: win,
  text,
  onTextChange,
  onSent,
}: {
  sessionId: string;
  channel: string;
  window: ReplyWindow | null;
  text: string;
  onTextChange: (v: string) => void;
  onSent: () => void;
}) {
  const [mode, setMode] = useState<"reply" | "private">("reply");
  const [sending, setSending] = useState(false);
  const comment = isCommentChannel(channel);
  const closed = !comment && win?.state === "closed";

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${sessionId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...(comment ? { mode } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send");
      onTextChange("");
      toast.success(comment && mode === "reply" ? "Reply posted" : "Message sent");
      onSent();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {comment ? (
          <div className="flex items-center rounded-md border overflow-hidden">
            {(["reply", "private"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn("px-2 py-1 text-xs", mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent/40")}
              >
                {m === "reply" ? "Public reply" : "Private message"}
              </button>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1">
            {win?.state === "open" ? (
              <>Reply window: {hoursLeft(win.closesAt)} left</>
            ) : win?.state === "human_agent" ? (
              <>
                <Lock size={10} /> Over 24 h: only your team can reply, for {hoursLeft(win.closesAt)} more
              </>
            ) : (
              <>
                <Lock size={10} /> Meta closed this conversation. You can reply when the customer writes again.
              </>
            )}
          </span>
        )}
        {comment && mode === "private" && <span>Opens a DM with the commenter (once per comment, within 7 days).</span>}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={closed ? "Replies are closed" : comment && mode === "reply" ? "Write a public reply…" : "Write a message…"}
          disabled={closed || sending}
          maxLength={2000}
          className="min-h-[60px] text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <Button onClick={send} disabled={closed || sending || !text.trim()} className="shrink-0">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Send
        </Button>
      </div>
    </div>
  );
}

/** Header actions for a social thread: take over from the AI and create a lead. */
export function SocialThreadActions({
  sessionId,
  autoReplyPaused,
  status,
  hasLead,
  visitorName,
  onChanged,
}: {
  sessionId: string;
  autoReplyPaused: boolean;
  status: string;
  hasLead: boolean;
  visitorName: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({ name: visitorName ?? "", email: "", phone: "" });
  const paused = autoReplyPaused || status === "handover";

  async function togglePause() {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoReplyPaused: !paused }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update");
      toast.success(paused ? "AI replies resumed for this conversation" : "You took over: AI replies paused");
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  async function createLead() {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${sessionId}/lead`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lead),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create lead");
      toast.success(data.created ? "Lead created" : "Lead updated");
      setLeadOpen(false);
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not create lead");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant={paused ? "default" : "outline"}
        onClick={togglePause}
        disabled={busy}
        className="gap-1.5 shrink-0"
        title={paused ? "Let the AI answer again" : "Stop AI replies in this conversation"}
      >
        {paused ? <Bot size={14} /> : <Hand size={14} />}
        <span className="hidden md:inline">{paused ? "Resume AI" : "Take over"}</span>
      </Button>
      {!hasLead && (
        <Button size="sm" variant="outline" onClick={() => setLeadOpen(true)} className="gap-1.5 shrink-0">
          <UserPlus size={14} />
          <span className="hidden md:inline">Create lead</span>
        </Button>
      )}
      <Dialog open={leadOpen} onOpenChange={setLeadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create lead from this conversation</DialogTitle>
            <DialogDescription>Add whatever the customer shared. Leave a field empty if you don&apos;t have it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(["name", "email", "phone"] as const).map((f) => (
              <div key={f} className="space-y-1">
                <Label htmlFor={`lead-${f}`} className="capitalize">
                  {f}
                </Label>
                <Input id={`lead-${f}`} value={lead[f]} onChange={(e) => setLead((l) => ({ ...l, [f]: e.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createLead} disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />} Create lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
