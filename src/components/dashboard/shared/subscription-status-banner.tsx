"use client";

import { AlertTriangle, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewId } from "@/components/dashboard/app-shell";

interface SubscriptionStatusBannerProps {
  subscription: {
    status: string;
    level: "full" | "read_only" | "blocked";
    message?: string;
  } | null;
  onNavigate: (view: ViewId) => void;
}

export function SubscriptionStatusBanner({
  subscription,
  onNavigate,
}: SubscriptionStatusBannerProps) {
  if (!subscription || subscription.level === "full") return null;

  const isBlocked = subscription.level === "blocked";

  return (
    <div
      className={
        isBlocked
          ? "bg-destructive/10 border-b border-destructive/30 px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
          : "bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle
          className={`h-4 w-4 shrink-0 ${isBlocked ? "text-destructive" : "text-amber-600"}`}
        />
        <span className={isBlocked ? "text-destructive" : "text-amber-900 dark:text-amber-200"}>
          {subscription.message ||
            (isBlocked
              ? "Your subscription is inactive. Reactivate to restore full access."
              : "Account is in read-only mode until payment is resolved.")}
        </span>
      </div>
      <Button
        size="sm"
        variant={isBlocked ? "destructive" : "secondary"}
        className="shrink-0 h-8 gap-1.5"
        onClick={() => onNavigate("subscription")}
      >
        <CreditCard className="h-3.5 w-3.5" />
        Manage billing
      </Button>
    </div>
  );
}
