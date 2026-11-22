"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Lock } from "lucide-react";
import { toast } from "sonner";

/** Websites allowed to run the widget. Off = any website. */
export function WidgetOriginsCard() {
  const [loaded, setLoaded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [locked, setLocked] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/business/widget-origins")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setSaved(d.origins);
        setLocked(d.origins.length > 0);
        setText(d.origins.join("\n"));
        setCanEdit(!!d.canEdit);
      })
      .catch(() => setError("Couldn't load the allowed websites."))
      .finally(() => setLoaded(true));
  }, []);

  const entries = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const target = locked ? entries : [];
  const dirty = JSON.stringify(target) !== JSON.stringify(saved);

  async function save() {
    if (locked && entries.length === 0) {
      setError("Add at least one website, or turn the lock off.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/business/widget-origins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins: target }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setSaved(d.origins);
      setText(d.origins.join("\n"));
      setLocked(d.origins.length > 0);
      toast.success(d.origins.length > 0 ? "Widget locked to your websites" : "Widget allowed on any website");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {saved.length > 0 ? <Lock size={16} /> : <Globe size={16} />} Allowed websites
        </CardTitle>
        <CardDescription>
          Stop other websites from using your public key. Chats from them would use your AI credits and could show your bot under someone else&apos;s name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loaded ? (
          <Skeleton className="h-20" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="widget-lock" className="text-sm font-normal">
                Only run the widget on my websites
              </Label>
              <Switch id="widget-lock" checked={locked} onCheckedChange={setLocked} disabled={!canEdit} />
            </div>
            {locked && (
              <div className="space-y-1.5">
                <Textarea
                  aria-label="Allowed websites, one per line"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"example.com\n*.example.com"}
                  disabled={!canEdit}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  One per line. <code className="font-mono">example.com</code> also covers <code className="font-mono">www.example.com</code>; use{" "}
                  <code className="font-mono">*.example.com</code> for every subdomain.
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            {canEdit ? (
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change this.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
