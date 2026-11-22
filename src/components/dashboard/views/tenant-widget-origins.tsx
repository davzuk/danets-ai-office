"use client";

import * as React from "react";
import { toast } from "sonner";
import { Globe, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  businessId: string;
  origins: string[];
  onChanged?: () => void;
};

/**
 * Super-admin view and override of the websites allowed to run a tenant's
 * widget. The parent keys it on the saved list, so a reload resets the text.
 */
export function TenantWidgetOrigins({ businessId, origins, onChanged }: Props) {
  const [text, setText] = React.useState(origins.join("\n"));
  const [busy, setBusy] = React.useState(false);

  const entries = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const dirty = JSON.stringify(entries) !== JSON.stringify(origins);

  async function save(next: string[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetAllowedOrigins: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update");
      toast.success(next.length ? "Widget websites updated." : "Widget allowed on any website.");
      onChanged?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <div>
            <CardTitle className="text-sm">Widget websites</CardTitle>
            <CardDescription className="text-xs">
              {origins.length
                ? `The chat widget only runs on ${origins.length} website${origins.length === 1 ? "" : "s"}.`
                : "The chat widget runs on any website."}{" "}
              One host per line; empty means any website.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <Textarea
          aria-label="Websites allowed to run this tenant's widget"
          rows={Math.min(Math.max(origins.length, 2), 6)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Any website"
          className="font-mono text-xs"
          disabled={busy}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => save(entries)} disabled={busy || !dirty}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Save
          </Button>
          {origins.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => save([])} disabled={busy}>
              Allow any website
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
