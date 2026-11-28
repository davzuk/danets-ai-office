"use client";

import * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

const NONE = "__none__";

let cache: { at: number; options: CampaignOption[] | null } | null = null;

/** Clear the picker's shared list (after creating or renaming a campaign). */
export function invalidateCampaignOptions() {
  cache = null;
}

/**
 * Campaign options for pickers. `null` means the Campaigns module isn't
 * available to this tenant, so callers hide the picker.
 */
export function useCampaignOptions() {
  const [options, setOptions] = React.useState<CampaignOption[] | null | undefined>(cache && Date.now() - cache.at < 30_000 ? cache.options : undefined);
  React.useEffect(() => {
    if (options !== undefined) return;
    let live = true;
    fetch("/api/campaigns/options", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { campaigns: CampaignOption[] }).campaigns : null))
      .catch(() => null)
      .then((list) => {
        cache = { at: Date.now(), options: list };
        if (live) setOptions(list);
      });
    return () => {
      live = false;
    };
  }, [options]);
  return options;
}

/**
 * Pick a campaign (or none). Renders nothing while loading or when the
 * Campaigns module is off. A current value that isn't in the list (ended or
 * archived) is still shown, by `currentName`.
 */
export function CampaignSelect({
  value,
  onChange,
  currentName,
  disabled,
  id,
  className,
  size,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  currentName?: string | null;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: "sm" | "default";
}) {
  const options = useCampaignOptions();
  if (!options) return null;
  const list = value && !options.some((o) => o.id === value) ? [...options, { id: value, name: currentName || "Current campaign", status: "ended" }] : options;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={cn("w-full", className)} aria-label="Campaign">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No campaign</SelectItem>
        {list.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
            {o.status === "draft" ? " (draft)" : o.status === "paused" ? " (paused)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
