"use client";

import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ViewId } from "@/components/dashboard/app-shell";

interface ModuleLockedViewProps {
  moduleLabel: string;
  requiredPlanLabel: string;
  currentPlan: string;
  onUpgrade: () => void;
}

export function ModuleLockedView({
  moduleLabel,
  requiredPlanLabel,
  currentPlan,
  onUpgrade,
}: ModuleLockedViewProps) {
  return (
    <Card className="max-w-lg mx-auto mt-12 border-dashed">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle>{moduleLabel} is not on your plan</CardTitle>
        <CardDescription>
          Your current plan is <strong>{currentPlan}</strong>. Upgrade to{" "}
          <strong>{requiredPlanLabel}</strong> or higher to unlock this module.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button onClick={onUpgrade} className="gap-2">
          <Sparkles className="h-4 w-4" />
          View plans & upgrade
        </Button>
      </CardContent>
    </Card>
  );
}

export function isViewEnabled(
  view: ViewId,
  modules: {
    modules: Record<string, { enabled: boolean; label: string; requiredPlanLabel: string }>;
    plan: string;
  } | null
): boolean {
  if (!modules) return true;
  const info = modules.modules[view];
  return info?.enabled ?? true;
}

export function getViewLockInfo(
  view: ViewId,
  modules: {
    modules: Record<string, { enabled: boolean; label: string; requiredPlanLabel: string }>;
    plan: string;
  } | null
) {
  if (!modules) return null;
  const info = modules.modules[view];
  if (!info || info.enabled) return null;
  return {
    moduleLabel: info.label,
    requiredPlanLabel: info.requiredPlanLabel,
    currentPlan: modules.plan.charAt(0).toUpperCase() + modules.plan.slice(1),
  };
}
