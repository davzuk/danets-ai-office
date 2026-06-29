"use client";

import { useEffect, useState, useRef } from "react";
import { Bell, Users, MessageSquare, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/components/dashboard/app-shell";

interface NotifData {
  unread: number;
  counts: { leads: number; sessions: number; quotes: number };
  recentLeads: {
    id: string;
    name: string;
    service: string | null;
    quality: string;
    createdAt: string;
  }[];
}

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        const d = await r.json();
        if (!active) return;
        setData(d);
        if (d.unread > 0) setSeen(false);
      } catch {}
    }
    load();
    const interval = setInterval(load, 30000); // poll every 30s
    return () => {
      active = false;
      clearInterval(interval);
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
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover shadow-lg z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
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
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </Button>
          </div>

          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-2 p-3 border-b">
            <NotifChip
              icon={Users}
              label="New leads"
              count={data?.counts.leads ?? 0}
              color="text-destructive"
              onClick={() => {
                onNavigate("leads");
                setOpen(false);
              }}
            />
            <NotifChip
              icon={MessageSquare}
              label="Sessions"
              count={data?.counts.sessions ?? 0}
              color="text-primary"
              onClick={() => {
                onNavigate("conversations");
                setOpen(false);
              }}
            />
            <NotifChip
              icon={FileText}
              label="Quotes"
              count={data?.counts.quotes ?? 0}
              color="text-accent-foreground"
              onClick={() => {
                onNavigate("quotes");
                setOpen(false);
              }}
            />
          </div>

          {/* Recent leads list */}
          <div className="max-h-72 overflow-y-auto scroll-thin">
            {(data?.recentLeads ?? []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Bell size={28} className="mx-auto mb-2 opacity-30" />
                You&apos;re all caught up!
              </div>
            ) : (
              (data?.recentLeads ?? []).map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => {
                    onNavigate("leads");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors text-left border-b last:border-0"
                >
                  <div className="h-8 w-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center text-xs font-bold shrink-0">
                    {lead.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{lead.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {lead.service || "New lead captured"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] h-4 px-1.5",
                        lead.quality === "high"
                          ? "border-destructive/30 text-destructive"
                          : lead.quality === "medium"
                          ? "border-accent text-accent-foreground"
                          : ""
                      )}
                    >
                      {lead.quality}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(lead.createdAt)}
                    </span>
                  </div>
                </button>
              ))
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
            View all leads →
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
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
