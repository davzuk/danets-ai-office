"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Facebook, Instagram, Linkedin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SocialAccountView {
  id: string;
  connectionId: string;
  platform: "facebook_page" | "instagram" | "linkedin_page" | string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  inboxEnabled: boolean;
  leadSyncEnabled: boolean;
  publishEnabled: boolean;
  autoReply: "off" | "draft" | "auto" | string;
  subscribed: boolean;
  status: string;
  lastError: string | null;
}

type Patch = Partial<Pick<SocialAccountView, "inboxEnabled" | "leadSyncEnabled" | "publishEnabled" | "autoReply">>;

const PLATFORM_ICON = { facebook_page: Facebook, instagram: Instagram, linkedin_page: Linkedin } as const;
const PLATFORM_LABEL: Record<string, string> = {
  facebook_page: "Facebook Page",
  instagram: "Instagram",
  linkedin_page: "LinkedIn Page",
};

/** Per-asset switches under a connection: what Danets may do with each Page / IG account. */
export function SocialAccountRows({
  accounts,
  canManage,
  onChange,
}: {
  accounts: SocialAccountView[];
  canManage: boolean;
  onChange: (account: SocialAccountView) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function update(acct: SocialAccountView, patch: Patch) {
    setSaving(acct.id);
    onChange({ ...acct, ...patch }); // optimistic
    try {
      const res = await fetch(`/api/social-accounts/${acct.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      onChange(data.account);
    } catch (e: unknown) {
      onChange(acct);
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  if (accounts.length === 0) return null;
  return (
    <div className="divide-y rounded-md border bg-background">
      {accounts.map((a) => {
        const Icon = PLATFORM_ICON[a.platform as keyof typeof PLATFORM_ICON] ?? Facebook;
        const disabled = !canManage || saving === a.id || a.status !== "active";
        const toggles: { key: keyof Patch; label: string; show: boolean }[] = [
          { key: "leadSyncEnabled", label: "Lead Ads", show: a.platform === "facebook_page" },
          { key: "inboxEnabled", label: "Inbox", show: true },
          { key: "publishEnabled", label: "Publishing", show: true },
        ];
        return (
          <div key={a.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {a.pictureUrl ? (
                <img
                  src={a.pictureUrl}
                  alt=""
                  className="size-8 shrink-0 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="size-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{a.name}</span>
                  {a.username && <span className="text-xs text-muted-foreground">@{a.username}</span>}
                  {a.status !== "active" && (
                    <Badge variant="secondary" className="bg-destructive/15 text-destructive">
                      {a.status}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Icon className="size-3" /> {PLATFORM_LABEL[a.platform] ?? a.platform}
                  {a.platform === "facebook_page" &&
                    a.status === "active" &&
                    !a.subscribed &&
                    " · connecting webhooks…"}
                </div>
                {a.lastError && a.status !== "active" && (
                  <div className="flex items-start gap-1 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {a.lastError}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {toggles
                .filter((t) => t.show)
                .map((t) => (
                  <div key={t.key} className="flex items-center gap-2">
                    <Switch
                      id={`${a.id}-${t.key}`}
                      checked={a[t.key] as boolean}
                      disabled={disabled}
                      onCheckedChange={(v) => update(a, { [t.key]: v })}
                    />
                    <Label htmlFor={`${a.id}-${t.key}`} className="text-xs font-normal">
                      {t.label}
                    </Label>
                  </div>
                ))}
              <Select
                value={a.autoReply}
                disabled={disabled || !a.inboxEnabled}
                onValueChange={(v) => update(a, { autoReply: v })}
              >
                <SelectTrigger size="sm" className="h-8 w-[150px] text-xs" aria-label="AI replies">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">AI replies: off</SelectItem>
                  <SelectItem value="draft">AI drafts replies</SelectItem>
                  <SelectItem value="auto">AI replies automatically</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
