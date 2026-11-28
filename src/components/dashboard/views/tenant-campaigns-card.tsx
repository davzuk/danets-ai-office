"use client";

// Platform console → tenant: the tenant's campaigns (Phase 4, workstream AA).
// Lists each campaign with its counts and lets the platform change its
// status, link the pages it builds to a campaign, and re-run matching.

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAMPAIGN_STATUSES, STATUS_LABELS, type CampaignStatus } from "@/lib/campaigns/rules";

interface Campaign {
  id: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  counts: { touches: number; leads: number; assets: number };
}
interface Page {
  id: string;
  title: string;
  slug: string;
  status: string;
  campaignId: string | null;
  subdomain: string;
}
interface Data {
  campaigns: Campaign[];
  pages: Page[];
  limit: { used: number; limit: number };
}

const NONE = "__none__";

export function TenantCampaignsCard({ businessId }: { businessId: string }) {
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const base = `/api/super-admin/businesses/${businessId}/campaigns`;

  React.useEffect(() => {
    fetch(base, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Couldn't load campaigns");
        setData(d as Data);
      })
      .catch((e: Error) => setError(e.message));
  }, [base]);

  async function post(key: string, body: Record<string, unknown>, success: string) {
    setBusy(key);
    try {
      const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong");
      setData(d as Data);
      toast.success(typeof d.matched === "number" ? `${success}: ${d.matched} touch${d.matched === 1 ? "" : "es"} linked` : success);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const open = data?.campaigns.filter((c) => c.status !== "archived") ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" /> Campaigns
            </CardTitle>
            <CardDescription>
              {data ? (data.limit.limit > 0 ? `${data.limit.used} of ${data.limit.limit} open` : `${data.limit.used} open, no limit`) : "The tenant's campaigns and the pages linked to them."}
            </CardDescription>
          </div>
          {data && data.campaigns.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => post("rematch", { action: "rematch" }, "Matching done")} disabled={!!busy}>
              {busy === "rematch" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Re-match touches
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : data.campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{c.slug}</code> · {c.counts.leads} leads · {c.counts.touches} touches · {c.counts.assets} items
                  </p>
                </div>
                <Select value={c.status} onValueChange={(v) => post(`status:${c.id}`, { action: "status", campaignId: c.id, status: v }, `Set to ${STATUS_LABELS[v as CampaignStatus]}`)} disabled={!!busy}>
                  <SelectTrigger size="sm" className="h-8 w-32 text-xs" aria-label={`Status of ${c.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}

        {data && data.pages.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Website pages</p>
            <ul className="divide-y rounded-md border">
              {data.pages.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{p.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.subdomain}/{p.slug} ·{" "}
                      <Badge variant="outline" className="text-[10px]">
                        {p.status}
                      </Badge>
                    </p>
                  </div>
                  <Select
                    value={p.campaignId ?? NONE}
                    onValueChange={(v) => post(`page:${p.id}`, { action: "link_page", pageId: p.id, campaignId: v === NONE ? null : v }, v === NONE ? "Page unlinked" : "Page linked")}
                    disabled={!!busy || (open.length === 0 && !p.campaignId)}
                  >
                    <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label={`Campaign for ${p.title}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No campaign</SelectItem>
                      {(p.campaignId && !open.some((c) => c.id === p.campaignId) ? [...open, ...data.campaigns.filter((c) => c.id === p.campaignId)] : open).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
