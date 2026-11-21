"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Circle,
  Sparkles,
  X,
  Bot,
  BookOpen,
  Palette,
  Code2,
  MessageSquare,
  Users,
  ChevronRight,
  Loader2,
  PartyPopper,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/components/dashboard/app-shell";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  href: ViewId;
}

interface OnboardingData {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  percentage: number;
  isComplete: boolean;
}

const STEP_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  agent: Bot,
  kb: BookOpen,
  brand: Palette,
  brand_voice: Megaphone,
  embed: Code2,
  test: MessageSquare,
  lead: Users,
};

export function OnboardingChecklist({
  businessId,
  onNavigate,
}: {
  businessId: string;
  onNavigate: (v: ViewId) => void;
}) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("danets_onboarding_dismissed") === "true";
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      return localStorage.getItem("danets_onboarding_dismissed") !== "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (dismissed) return;
    let active = true;
    fetch("/api/onboarding", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (active) setData(d);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [businessId, dismissed]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem("danets_onboarding_dismissed", "true");
    } catch {}
  }

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Don't show if dismissed or all steps complete
  if (dismissed || (data?.isComplete && dismissed)) {
    return null;
  }

  if (data?.isComplete) {
    // Show a brief celebration then allow dismiss
    return (
      <Card className="overflow-hidden border-accent/30 bg-accent/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-accent/20 flex items-center justify-center shrink-0">
              <PartyPopper size={24} className="text-accent-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-base">You&apos;re all set! 🎉</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your AI automation is fully configured. Your chatbot is ready to
                capture leads and answer visitors 24/7.
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={dismiss}>
              <X size={16} />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg brand-gradient flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Getting Started</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Complete these steps to launch your AI automation
              </p>
            </div>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={dismiss}>
            <X size={16} />
          </Button>
        </div>
        {/* Progress bar */}
        <div className="flex items-center gap-3 mt-3">
          <Progress value={data.percentage} className="h-2 flex-1" />
          <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
            {data.completedCount}/{data.totalCount}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.steps.map((step) => {
            const Icon = STEP_ICONS[step.id] || Circle;
            return (
              <button
                key={step.id}
                onClick={() => onNavigate(step.href)}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg p-2.5 text-left transition-all group hover:bg-muted/50",
                  step.completed && "opacity-70"
                )}
              >
                <div className="shrink-0 mt-0.5">
                  {step.completed ? (
                    <CheckCircle2 size={18} className="text-accent-foreground" />
                  ) : (
                    <div className="h-[18px] w-[18px] rounded-full border-2 border-muted-foreground/30 group-hover:border-primary transition-colors flex items-center justify-center">
                      <Icon size={10} className="text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-sm font-medium leading-tight",
                    step.completed && "line-through text-muted-foreground"
                  )}>
                    {step.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                    {step.description}
                  </div>
                </div>
                {!step.completed && (
                  <ChevronRight size={14} className="text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
