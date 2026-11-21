"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Facebook, FileText, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Target = "name" | "email" | "phone" | "company" | "service" | "message" | "ignore";

interface LeadForm {
  id: string;
  accountName: string;
  name: string;
  metaStatus: string | null;
  enabled: boolean;
  questions: { key: string; label: string; type: string | null; target: Target }[];
  leadsImported: number;
  lastLeadAt: string | null;
  polledThrough: string | null;
}

interface Page {
  id: string;
  name: string;
  status: string;
  leadSyncEnabled: boolean;
}

const TARGET_LABEL: Record<Target, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  service: "Service / interest",
  message: "Add to message",
  ignore: "Don't import",
};

/** Leads → Lead forms: Meta Lead Ads forms, their on/off switch and field mapping. */
export function LeadFormsPanel({ onOpenIntegrations }: { onOpenIntegrations?: () => void }) {
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<LeadForm | null>(null);
  const [draft, setDraft] = useState<Record<string, Target>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lead-forms", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load lead forms");
      setForms(data.forms ?? []);
      setPages(data.pages ?? []);
      setCanManage(!!data.canManage);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load lead forms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(form: LeadForm, body: { enabled?: boolean; fieldMapping?: Record<string, Target> }) {
    const res = await fetch(`/api/lead-forms/${form.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save");
    setForms((prev) => prev.map((f) => (f.id === form.id ? data.form : f)));
  }

  async function toggle(form: LeadForm, enabled: boolean) {
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, enabled } : f)));
    try {
      await patch(form, { enabled });
    } catch (e: unknown) {
      setForms((prev) => prev.map((f) => (f.id === form.id ? form : f)));
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function saveMapping() {
    if (!editing) return;
    setSaving(true);
    try {
      await patch(editing, { fieldMapping: draft });
      toast.success("Field mapping saved", { description: "Applies to new leads from this form." });
      setEditing(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/lead-forms/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start sync");
      toast.success(data.queued ? "Checking Meta for new leads" : "No Pages have lead sync switched on", {
        description: data.queued ? "New forms and leads appear in a minute or two." : undefined,
      });
      setTimeout(load, 15_000);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not start sync");
    } finally {
      setSyncing(false);
    }
  }

  const syncedPages = pages.filter((p) => p.leadSyncEnabled && p.status === "active");

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText size={15} /> Meta lead forms
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Leads from Facebook and Instagram Lead Ads arrive here automatically, tagged with the campaign and ad
            that produced them.
          </p>
        </div>
        {canManage && syncedPages.length > 0 && (
          <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing} className="gap-1.5">
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Check for leads now
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : pages.length === 0 ? (
        <EmptyState
          text="Connect a Facebook Page under Integrations → Connected accounts, then switch on Lead Ads for it."
          onOpenIntegrations={onOpenIntegrations}
        />
      ) : syncedPages.length === 0 ? (
        <EmptyState
          text={`Lead Ads sync is off for ${pages.map((p) => p.name).join(", ")}. Switch it on under Integrations → Connected accounts to import the last 90 days of leads.`}
          onOpenIntegrations={onOpenIntegrations}
        />
      ) : forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No lead forms found yet on {syncedPages.map((p) => p.name).join(", ")}. Forms appear after the first sync
          (within the hour) or when a lead arrives.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {forms.map((f) => (
            <div key={f.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{f.name}</span>
                  {f.metaStatus && f.metaStatus !== "ACTIVE" && (
                    <Badge variant="secondary" className="text-[10px]">
                      {f.metaStatus.toLowerCase()}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Facebook className="size-3" /> {f.accountName}
                  </span>
                  <span>
                    {f.leadsImported} lead{f.leadsImported === 1 ? "" : "s"} imported
                  </span>
                  {f.lastLeadAt && <span>last {new Date(f.lastLeadAt).toLocaleString()}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  disabled={f.questions.length === 0}
                  onClick={() => {
                    setDraft(Object.fromEntries(f.questions.map((q) => [q.key, q.target])));
                    setEditing(f);
                  }}
                >
                  <Settings2 className="size-4" /> Fields
                </Button>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`form-${f.id}`}
                    checked={f.enabled}
                    disabled={!canManage}
                    onCheckedChange={(v) => toggle(f, v)}
                    aria-label={`Import leads from ${f.name}`}
                  />
                  <label htmlFor={`form-${f.id}`} className="text-xs">
                    Import
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Field mapping: {editing?.name}</DialogTitle>
            <DialogDescription>
              Choose where each form question goes on the lead. Answers set to &quot;Add to message&quot; are kept
              as &quot;Question: answer&quot; lines.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {editing?.questions.map((q) => (
              <div key={q.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{q.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{q.key}</div>
                </div>
                <Select
                  value={draft[q.key] ?? q.target}
                  disabled={!canManage}
                  onValueChange={(v) => setDraft((d) => ({ ...d, [q.key]: v as Target }))}
                >
                  <SelectTrigger size="sm" className="w-[170px] shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TARGET_LABEL) as Target[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TARGET_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            {canManage && (
              <Button onClick={saveMapping} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save mapping
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EmptyState({ text, onOpenIntegrations }: { text: string; onOpenIntegrations?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      <p>{text}</p>
      {onOpenIntegrations && (
        <Button size="sm" variant="outline" onClick={onOpenIntegrations}>
          Open Integrations
        </Button>
      )}
    </div>
  );
}
