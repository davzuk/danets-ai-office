"use client";

import { useEffect, useState, useRef } from "react";
import {
  Bell,
  Users,
  MessageSquare,
  FileText,
  Ticket,
  X,
  CheckCheck,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  Zap,
  Lightbulb,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/components/dashboard/app-shell";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  data: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotifData {
  unread: number;
  counts: { leads: number; sessions: number; tickets: number };
  notifications: NotificationItem[];
}

const TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  new_lead: Users,
  high_quality_lead: TrendingUp,
  new_ticket: Ticket,
  urgent_ticket: AlertTriangle,
  proposal_generated: FileText,
  proposal_accepted: CheckCheck,
  follow_up_reminder: Bell,
  ai_usage_warning: Zap,
  subscription_expiry: AlertTriangle,
  integration_failed: AlertTriangle,
  new_chat_session: MessageSquare,
  content_insight: Lightbulb,
  content_review: CalendarClock,
  content_manual_due: CalendarClock,
  content_publish_failed: AlertTriangle,
};

const TYPE_COLORS: Record<string, string> = {
  new_lead: "bg-primary/15 text-primary",
  high_quality_lead: "bg-accent/20 text-accent-foreground",
  new_ticket: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  urgent_ticket: "bg-destructive/15 text-destructive",
  proposal_generated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  proposal_accepted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  follow_up_reminder: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  ai_usage_warning: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  subscription_expiry: "bg-destructive/15 text-destructive",
  integration_failed: "bg-destructive/15 text-destructive",
  new_chat_session: "bg-primary/15 text-primary",
  content_insight: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  content_review: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  content_manual_due: "bg-primary/15 text-primary",
  content_publish_failed: "bg-destructive/15 text-destructive",
};

export function NotificationBell({
  businessId,
  onNavigate,
}: {
  businessId: string;
  onNavigate: (v: ViewId) => void;
}) {
  const [data, setData] = useState<NotifData | null>(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        const d = await r.json();
        if (!active) return;
        setData(d);
        if (d.unread > 0) setSeen(false);
      } catch {}
    }

    function startPolling() {
      // Avoid duplicate intervals if visibility flips repeatedly.
      if (interval) return;
      load();
      interval = setInterval(load, 30000);
    }

    function stopPolling() {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    }

    // Skip polling while the tab is hidden — no point burning requests
    // (and server load) for a notification list the user can't see.
    // When the tab becomes visible again, refresh immediately so the
    // user sees fresh data on the first paint.
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        startPolling();
      } else {
        stopPolling();
      }
    }

    if (document.visibilityState === "visible") {
      startPolling();
    } else {
      // Tab opened in the background — still do one initial fetch so the
      // bell badge shows the right count when the user switches to it.
      load();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [businessId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unread = data?.unread ?? 0;
  const showBadge = unread > 0 && !seen;
  const notifications = data?.notifications || [];

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      setData((prev) =>
        prev
          ? {
              ...prev,
              unread: 0,
              notifications: prev.notifications.map((n) => ({ ...n, readAt: new Date().toISOString() })),
            }
          : prev
      );
      setSeen(true);
    } catch {
    } finally {
      setMarkingAll(false);
    }
  }

  async function markOneRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      setData((prev) =>
        prev
          ? {
              ...prev,
              unread: Math.max(0, prev.unread - 1),
              notifications: prev.notifications.map((n) =>
                n.id === id ? { ...n, readAt: new Date().toISOString() } : n
              ),
            }
          : prev
      );
    } catch {}
  }

  function handleNotifClick(n: NotificationItem) {
    if (!n.readAt) markOneRead(n.id);
    // Navigate based on type
    const navMap: Record<string, ViewId> = {
      new_lead: "leads",
      high_quality_lead: "leads",
      new_ticket: "tickets",
      urgent_ticket: "tickets",
      proposal_generated: "quotes",
      proposal_accepted: "quotes",
      new_chat_session: "conversations",
      content_insight: "social",
      content_review: "social",
      content_manual_due: "social",
      content_publish_failed: "social",
    };
    const view = navMap[n.type];
    if (n.type === "content_insight") {
      // Land on Content Studio's Analytics tab (read once by ContentStudioView).
      try {
        sessionStorage.setItem("studio-tab", "analytics");
      } catch {}
    }
    if (view) {
      onNavigate(view);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 relative"
        onClick={() => {
          setOpen(!open);
          if (!open) setSeen(true);
        }}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
      >
        <Bell size={18} className={cn(unread > 0 && "animate-[wiggle_0.5s_ease-in-out]")} />
        {showBadge && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover shadow-lg z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unread > 0 && (
                <Badge variant="destructive" className="text-[10px] h-5">
                  {unread} new
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={markAllRead}
                  disabled={markingAll}
                >
                  <CheckCheck size={13} />
                  <span className="hidden sm:inline">Mark all read</span>
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </Button>
            </div>
          </div>

          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-2 p-3 border-b">
            <NotifChip
              icon={Users}
              label="New leads"
              count={data?.counts.leads ?? 0}
              color="text-primary"
              onClick={() => {
                onNavigate("leads");
                setOpen(false);
              }}
            />
            <NotifChip
              icon={MessageSquare}
              label="Sessions"
              count={data?.counts.sessions ?? 0}
              color="text-accent-foreground"
              onClick={() => {
                onNavigate("conversations");
                setOpen(false);
              }}
            />
            <NotifChip
              icon={Ticket}
              label="Tickets"
              count={data?.counts.tickets ?? 0}
              color="text-rose-600 dark:text-rose-400"
              onClick={() => {
                onNavigate("tickets");
                setOpen(false);
              }}
            />
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto scroll-thin">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Bell size={28} className="mx-auto mb-2 opacity-30" />
                You&apos;re all caught up!
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] || Bell;
                const colorClass = TYPE_COLORS[n.type] || "bg-muted text-muted-foreground";
                const isUnread = !n.readAt;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleNotifClick(n)}
                    className={cn(
                      "w-full flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors text-left border-b last:border-0",
                      isUnread && "bg-primary/[0.03]"
                    )}
                  >
                    <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", colorClass)}>
                      <Icon size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-sm truncate", isUnread ? "font-semibold" : "font-medium")}>
                          {n.title}
                        </span>
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {n.message}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <button
            onClick={() => {
              onNavigate("leads");
              setOpen(false);
            }}
            className="w-full text-center text-xs font-medium text-primary py-2.5 hover:bg-primary/5 transition-colors border-t"
          >
            View all activity →
          </button>
        </div>
      )}
    </div>
  );
}

function NotifChip({
  icon: Icon,
  label,
  count,
  color,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  count: number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg p-2 hover:bg-muted/60 transition-colors"
    >
      <div className={`h-8 w-8 rounded-lg bg-muted flex items-center justify-center ${color}`}>
        <Icon size={15} />
      </div>
      <span className="text-base font-bold tabular-nums">{count}</span>
      <span className="text-[10px] text-muted-foreground leading-none">{label}</span>
    </button>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
