"use client";

import { useEffect, useState } from "react";
import { X, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Announcement {
  id: string;
  title: string;
  message: string;
  severity: string;
}

const DISMISS_KEY = "danets_dismissed_announcements";

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function dismiss(id: string) {
  const set = getDismissed();
  set.add(id);
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
}

const SEVERITY = {
  info: {
    icon: Info,
    bar: "bg-blue-500/10 border-blue-500/30 text-blue-900 dark:text-blue-100",
  },
  warning: {
    icon: AlertTriangle,
    bar: "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-100",
  },
  critical: {
    icon: AlertCircle,
    bar: "bg-destructive/10 border-destructive/30 text-destructive",
  },
};

export function PlatformAnnouncementBanner({
  isSuperAdmin,
  isPlatformAdmin,
}: {
  isSuperAdmin?: boolean;
  isPlatformAdmin?: boolean;
}) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(getDismissed());
    fetch("/api/announcements", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((d) => setAnnouncements(d.announcements || []))
      .catch(() => {});
  }, []);

  if (isSuperAdmin || isPlatformAdmin) return null;

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 px-4 lg:px-6 pt-3">
      {visible.map((a) => {
        const meta = SEVERITY[a.severity as keyof typeof SEVERITY] || SEVERITY.info;
        const Icon = meta.icon;
        return (
          <div
            key={a.id}
            className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", meta.bar)}
          >
            <Icon className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{a.title}</div>
              <div className="opacity-90 mt-0.5">{a.message}</div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 opacity-70 hover:opacity-100"
              onClick={() => {
                dismiss(a.id);
                setDismissed((prev) => new Set([...prev, a.id]));
              }}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
