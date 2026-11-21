"use client";

import { PLATFORM_RULES, type ContentPlatform } from "@/lib/content/platforms";
import { cn } from "@/lib/utils";

// Helpers shared by the Content Studio and its calendar.

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export const PLATFORM_COLOR: Record<ContentPlatform, string> = {
  facebook: "bg-[#1877F2]",
  instagram: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]",
  linkedin: "bg-[#0A66C2]",
  x: "bg-black dark:bg-white dark:text-black",
  tiktok: "bg-black",
};

export function PlatformDot({ platform, className }: { platform: ContentPlatform | string; className?: string }) {
  const p = platform as ContentPlatform;
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase text-white",
        PLATFORM_COLOR[p] ?? "bg-muted",
        className
      )}
      title={PLATFORM_RULES[p]?.label ?? platform}
    >
      {p === "linkedin" ? "in" : p === "tiktok" ? "tt" : String(platform).slice(0, 1)}
    </span>
  );
}
