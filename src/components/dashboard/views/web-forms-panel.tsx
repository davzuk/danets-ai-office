"use client";

// Leads → Forms (Phase 2, workstream S): the tenant's own lead-capture
// forms. Build one (fields, mapping to the lead, settings), share it as a
// hosted page or embed it on any website, and review submissions, including
// the ones held as spam.

import * as React from "react";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  Check,
  ClipboardList,
  Code2,
  Copy,
  ExternalLink,
  GripVertical,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FORM_FIELD_TYPES, type FormField, type FormFieldType, type FormMapTarget } from "@/lib/forms/schema";
import { LeadFormRenderer } from "@/components/forms/lead-form-renderer";

interface Settings {
  submitLabel: string;
  successMessage: string;
  redirectUrl: string | null;
  consentText: string | null;
  leadQuality: "low" | "medium" | "high" | null;
}

interface WebForm {
  id: string;
  name: string;
  status: "active" | "archived";
  submissions: number;
  createdAt: string;
  fields: FormField[];
  settings: Settings;
}

interface Submission {
  id: string;
  leadId: string | null;
  data: Record<string, unknown>;
  pageUrl: string | null;
  status: "accepted" | "spam";
  createdAt: string;
  lead: { id: string; name: string; email: string | null } | null;
}

// Fields carry a client-only id so dnd-kit can track them while keys change.
type DraftField = FormField & { uid: string };

const TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Short text",
  email: "Email",
  phone: "Phone",
  textarea: "Long text",
  select: "Dropdown",
  radio: "Single choice",
  checkbox: "Checkboxes",
  date: "Date",
  hidden: "Hidden",
};

const MAP_LABELS: Record<FormMapTarget, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  service: "Service",
  message: "Message",
};

const DEFAULT_SETTINGS: Settings = {
  submitLabel: "Submit",
  successMessage: "Thanks — we'll be in touch.",
  redirectUrl: null,
  consentText: null,
  leadQuality: null,
};

const f = (key: string, type: FormFieldType, label: string, extra: Partial<FormField> = {}): FormField => ({ key, type, label, required: false, ...extra });

const TEMPLATES: { id: string; name: string; description: string; fields: FormField[]; submitLabel: string }[] = [
  {
    id: "contact",
    name: "Contact us",
    description: "Name, email, phone and a message.",
    submitLabel: "Send message",
    fields: [
      f("name", "text", "Your name", { required: true, mapTo: "name" }),
      f("email", "email", "Email", { required: true, mapTo: "email" }),
      f("phone", "phone", "Phone", { mapTo: "phone" }),
      f("message", "textarea", "How can we help?", { mapTo: "message" }),
    ],
  },
  {
    id: "quote",
    name: "Quote request",
    description: "Contact details, the service and the job.",
    submitLabel: "Request a quote",
    fields: [
      f("name", "text", "Your name", { required: true, mapTo: "name" }),
      f("email", "email", "Email", { required: true, mapTo: "email" }),
      f("phone", "phone", "Phone", { mapTo: "phone" }),
      f("company", "text", "Company", { mapTo: "company" }),
      f("service", "select", "Service", { required: true, mapTo: "service", options: ["Service A", "Service B", "Something else"] }),
      f("details", "textarea", "Tell us about the job", { mapTo: "message" }),
    ],
  },
  {
    id: "callback",
    name: "Call me back",
    description: "A name, a number and a good time to call.",
    submitLabel: "Call me back",
    fields: [
      f("name", "text", "Your name", { required: true, mapTo: "name" }),
      f("phone", "phone", "Phone number", { required: true, mapTo: "phone" }),
      f("best_time", "radio", "Best time to call", { options: ["Morning", "Afternoon", "Evening"] }),
    ],
  },
  {
    id: "newsletter",
    name: "Newsletter sign-up",
    description: "Email and first name, with a consent box.",
    submitLabel: "Subscribe",
    fields: [f("email", "email", "Email", { required: true, mapTo: "email" }), f("name", "text", "First name", { mapTo: "name" })],
  },
];

const uid = () => Math.random().toString(36).slice(2, 10);

function keyFromLabel(label: string, taken: Set<string>): string {
  let base = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  if (!/^[a-z]/.test(base)) base = `field${base ? `_${base}` : ""}`.slice(0, 24);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 403 ? "Only owners and admins can change forms." : "Something went wrong."));
  return d as T;
}

export function CopyField({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-start gap-2">
        {multiline ? (
          <Textarea readOnly value={value} rows={3} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Couldn't copy. Select the text and copy it yourself.");
            }
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Field row ──────────────────────────────────────────────────────

function FieldRow({
  field,
  open,
  onToggle,
  onChange,
  onRemove,
  usedTargets,
}: {
  field: DraftField;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DraftField>) => void;
  onRemove: () => void;
  usedTargets: Set<FormMapTarget>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.uid });
  const hasOptions = field.type === "select" || field.type === "radio" || field.type === "checkbox";
  const [optionsText, setOptionsText] = React.useState((field.options ?? []).join("\n"));
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={`rounded-lg border bg-background ${isDragging ? "z-10 shadow-lg" : ""}`}>
      <div className="flex items-center gap-2 p-2">
        <button type="button" className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`Reorder ${field.label}`} {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <span className="truncate text-sm font-medium">{field.label || "Untitled field"}</span>
          {field.required && <span className="text-destructive">*</span>}
          <Badge variant="outline" className="shrink-0 font-normal">
            {TYPE_LABELS[field.type]}
          </Badge>
          {field.mapTo && (
            <Badge variant="secondary" className="shrink-0 font-normal">
              → {MAP_LABELS[field.mapTo]}
            </Badge>
          )}
        </button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${field.label}`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {open && (
        <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`fl-${field.uid}`}>Label</Label>
            <Input id={`fl-${field.uid}`} value={field.label} maxLength={120} onChange={(e) => onChange({ label: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={field.type} onValueChange={(v) => onChange({ type: v as FormFieldType })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORM_FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Save on the lead as</Label>
            <Select value={field.mapTo ?? "__none"} onValueChange={(v) => onChange({ mapTo: v === "__none" ? undefined : (v as FormMapTarget) })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Keep with the submission only</SelectItem>
                {(Object.keys(MAP_LABELS) as FormMapTarget[]).map((t) => (
                  <SelectItem key={t} value={t} disabled={usedTargets.has(t) && field.mapTo !== t}>
                    {MAP_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {field.type !== "hidden" && !hasOptions && (
            <div className="space-y-1.5">
              <Label htmlFor={`fp-${field.uid}`}>Placeholder</Label>
              <Input id={`fp-${field.uid}`} value={field.placeholder ?? ""} maxLength={120} onChange={(e) => onChange({ placeholder: e.target.value || undefined })} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`fk-${field.uid}`}>Key</Label>
            <Input
              id={`fk-${field.uid}`}
              value={field.key}
              maxLength={30}
              className="font-mono text-xs"
              onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
            />
            <p className="text-xs text-muted-foreground">
              {field.type === "hidden" ? "Filled from the link (?key=value) or the embed (data-key=\"value\")." : "Names this answer in exports and automations."}
            </p>
          </div>
          {hasOptions && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`fo-${field.uid}`}>Options (one per line)</Label>
              <Textarea
                id={`fo-${field.uid}`}
                rows={4}
                value={optionsText}
                onChange={(e) => {
                  setOptionsText(e.target.value);
                  onChange({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50) });
                }}
              />
            </div>
          )}
          {field.type !== "hidden" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={field.required} onCheckedChange={(v) => onChange({ required: v })} />
              Required
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Editor dialog ──────────────────────────────────────────────────

function FormEditor({
  open,
  onOpenChange,
  editing,
  template,
  businessName,
  brandColor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: WebForm | null;
  template: (typeof TEMPLATES)[number] | null;
  businessName: string;
  brandColor: string | null;
  onSaved: (form: WebForm) => void;
}) {
  // The parent remounts this (new key) each time it opens, so state starts
  // from the form being edited or the chosen template.
  const [src] = React.useState(
    () =>
      editing ??
      (template
        ? { name: template.name, fields: template.fields, settings: { ...DEFAULT_SETTINGS, submitLabel: template.submitLabel, consentText: template.id === "newsletter" ? "I'd like to receive emails. I can unsubscribe at any time." : null } }
        : null)
  );
  const [name, setName] = React.useState(src?.name ?? "");
  const [fields, setFields] = React.useState<DraftField[]>(() => (src?.fields ?? []).map((x) => ({ ...x, uid: uid() })));
  const [settings, setSettings] = React.useState<Settings>({ ...DEFAULT_SETTINGS, ...(src?.settings ?? {}) });
  const [openField, setOpenField] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const usedTargets = React.useMemo(() => new Set(fields.map((x) => x.mapTo).filter((x): x is FormMapTarget => !!x)), [fields]);

  const addField = () => {
    const taken = new Set(fields.map((x) => x.key));
    const nf: DraftField = { uid: uid(), key: keyFromLabel("New question", taken), type: "text", label: "New question", required: false };
    setFields((xs) => [...xs, nf]);
    setOpenField(nf.uid);
  };

  const patch = (id: string, p: Partial<DraftField>) =>
    setFields((xs) =>
      xs.map((x) => {
        if (x.uid !== id) return x;
        const next = { ...x, ...p };
        if (p.type && p.type !== "select" && p.type !== "radio" && p.type !== "checkbox") delete next.options;
        if (p.type === "hidden") next.required = false;
        return next;
      })
    );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setFields((xs) => {
      const from = xs.findIndex((x) => x.uid === e.active.id);
      const to = xs.findIndex((x) => x.uid === e.over!.id);
      return arrayMove(xs, from, to);
    });
  };

  const problem = React.useMemo(() => {
    if (!name.trim()) return "Give the form a name.";
    if (!fields.length) return "Add at least one field.";
    const keys = new Set<string>();
    for (const x of fields) {
      if (!x.label.trim()) return "Every field needs a label.";
      if (!/^[a-z][a-z0-9_]{0,29}$/.test(x.key)) return `"${x.label}" needs a key that starts with a letter (letters, numbers, underscores).`;
      if (keys.has(x.key)) return `Two fields use the key "${x.key}".`;
      keys.add(x.key);
      if ((x.type === "select" || x.type === "radio" || x.type === "checkbox") && !x.options?.length) return `Add options to "${x.label}".`;
    }
    if (!fields.some((x) => x.mapTo === "email" || x.mapTo === "phone")) return "Map an email or phone field to the lead, so you can reply.";
    if (settings.redirectUrl && !/^https?:\/\/\S+$/i.test(settings.redirectUrl)) return "The redirect must be a full web address (https://…).";
    return null;
  }, [name, fields, settings.redirectUrl]);

  const preview = React.useMemo(
    () => ({
      id: editing?.id ?? "preview",
      name: name || "Untitled form",
      businessName,
      brandColor,
      fields: fields.map(({ uid: _u, mapTo: _m, ...x }) => x),
      submitLabel: settings.submitLabel || "Submit",
      successMessage: settings.successMessage,
      redirectUrl: null,
      consentText: settings.consentText,
    }),
    [editing?.id, name, businessName, brandColor, fields, settings]
  );

  async function save() {
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({ name: name.trim(), fields: fields.map(({ uid: _u, ...x }) => x), settings });
      const d = editing
        ? await api<{ form: WebForm }>(`/api/forms/${editing.id}`, { method: "PATCH", body })
        : await api<{ form: WebForm }>("/api/forms", { method: "POST", body });
      toast.success(editing ? "Form saved." : "Form created. Share it or embed it on your website.");
      onSaved(d.form);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the form.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New form"}</DialogTitle>
          <DialogDescription>Each submission creates or updates a lead. Answers you don&apos;t map stay with the submission.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <div className="min-w-0 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Form name</Label>
              <Input id="wf-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Quote request" />
              <p className="text-xs text-muted-foreground">Shown as the title of the form&apos;s own page.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Fields</Label>
                <Button type="button" variant="outline" size="sm" onClick={addField} disabled={fields.length >= 30}>
                  <Plus className="mr-1 h-4 w-4" /> Add field
                </Button>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={fields.map((x) => x.uid)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {fields.map((x) => (
                      <FieldRow
                        key={x.uid}
                        field={x}
                        open={openField === x.uid}
                        onToggle={() => setOpenField((o) => (o === x.uid ? null : x.uid))}
                        onChange={(p) => patch(x.uid, p)}
                        onRemove={() => setFields((xs) => xs.filter((y) => y.uid !== x.uid))}
                        usedTargets={usedTargets}
                      />
                    ))}
                    {fields.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No fields yet.</p>}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wf-submit">Button text</Label>
                <Input id="wf-submit" value={settings.submitLabel} maxLength={80} onChange={(e) => setSettings((s) => ({ ...s, submitLabel: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead quality</Label>
                <Select value={settings.leadQuality ?? "__auto"} onValueChange={(v) => setSettings((s) => ({ ...s, leadQuality: v === "__auto" ? null : (v as Settings["leadQuality"]) }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto">Automatic</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wf-success">Thank-you message</Label>
                <Input id="wf-success" value={settings.successMessage} maxLength={300} onChange={(e) => setSettings((s) => ({ ...s, successMessage: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wf-redirect">Or send visitors to a page (optional)</Label>
                <Input id="wf-redirect" type="url" placeholder="https://yourbusiness.com/thank-you" value={settings.redirectUrl ?? ""} maxLength={500} onChange={(e) => setSettings((s) => ({ ...s, redirectUrl: e.target.value.trim() || null }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wf-consent">Consent checkbox (optional)</Label>
                <Textarea
                  id="wf-consent"
                  rows={2}
                  maxLength={300}
                  placeholder="I agree to be contacted about my enquiry."
                  value={settings.consentText ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, consentText: e.target.value || null }))}
                />
                <p className="text-xs text-muted-foreground">Visitors must tick it to submit. The wording and time are saved with each submission.</p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="lg:sticky lg:top-0">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="mb-4 text-lg font-semibold">{preview.name}</div>
                <LeadFormRenderer key={fields.map((x) => x.uid + x.type).join()} form={preview} preview />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-sm text-muted-foreground" role="status">
            {problem}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save form" : "Create form"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Share dialog ───────────────────────────────────────────────────

function ShareDialog({ form, onOpenChange }: { form: WebForm | null; onOpenChange: (v: boolean) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = form ? `${origin}/f/${form.id}` : "";
  const embed = form ? `<div data-danets-form="${form.id}"></div>\n<script src="${origin}/forms.js" async></script>` : "";
  return (
    <Dialog open={!!form} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {form?.name}</DialogTitle>
          <DialogDescription>Link to the form&apos;s own page, or put it on your website.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <CopyField label="Link" value={link} />
          <CopyField label="Embed code" value={embed} multiline />
          <p className="text-xs text-muted-foreground">
            Already using the chat widget? Just add the <code className="rounded bg-muted px-1">&lt;div&gt;</code>; the widget loads the form. Add <code className="rounded bg-muted px-1">data-chat=&quot;off&quot;</code> to the widget script for forms without the chat bubble. If you limit the widget to your own websites, forms follow the same list.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" asChild>
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Open page
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Submissions dialog ─────────────────────────────────────────────

function SubmissionsDialog({ form, onOpenChange, onOpenLead, onChanged }: { form: WebForm | null; onOpenChange: (v: boolean) => void; onOpenLead?: (lead: { id: string; name: string }) => void; onChanged: () => void }) {
  // Remounted per form by the parent, so the tab starts on "Received".
  const [tab, setTab] = React.useState<"accepted" | "spam">("accepted");
  const [reload, setReload] = React.useState(0);
  // Rows are tagged with what they were loaded for; anything else shows as loading.
  const [loaded, setLoaded] = React.useState<{ key: string; rows: Submission[] } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const loadKey = form ? `${form.id}:${tab}:${reload}` : "";
  const rows = loaded?.key === loadKey ? loaded.rows : null;
  const load = () => setReload((n) => n + 1);

  React.useEffect(() => {
    if (!form) return;
    let cancelled = false;
    api<{ submissions: Submission[] }>(`/api/forms/${form.id}/submissions?status=${tab}`)
      .then((d) => !cancelled && setLoaded({ key: loadKey, rows: d.submissions }))
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Could not load submissions.");
        setLoaded({ key: loadKey, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [form, tab, loadKey]);

  const labelFor = (key: string) => form?.fields.find((x) => x.key === key)?.label ?? key;

  async function act(s: Submission, how: "release" | "delete") {
    if (!form) return;
    setBusy(s.id);
    try {
      await api(`/api/forms/${form.id}/submissions/${s.id}`, { method: how === "release" ? "POST" : "DELETE" });
      toast.success(how === "release" ? "Released. A lead was created." : "Submission deleted.");
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={!!form} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{form?.name}: submissions</DialogTitle>
          <DialogDescription>The latest 200. Submissions that look automated are held as spam and create no lead.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="accepted">Received</TabsTrigger>
              <TabsTrigger value="spam">Spam</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="icon" aria-label="Refresh" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {!rows ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{tab === "spam" ? "Nothing held as spam." : "No submissions yet."}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((s) => (
              <li key={s.id} className="rounded-lg border p-3 text-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</span>
                    {s.lead && (
                      <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => onOpenLead?.(s.lead!)}>
                        {s.lead.name}
                      </button>
                    )}
                  </div>
                  {s.status === "spam" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7" disabled={busy === s.id} onClick={() => act(s, "release")}>
                        {busy === s.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Not spam
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7" disabled={busy === s.id} onClick={() => act(s, "delete")}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
                  {Object.entries(s.data ?? {})
                    .filter(([k]) => k !== "_consent")
                    .map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-muted-foreground">{labelFor(k)}</dt>
                        <dd className="min-w-0 whitespace-pre-wrap break-words">{typeof v === "string" ? v || "—" : String(v)}</dd>
                      </React.Fragment>
                    ))}
                </dl>
                {s.pageUrl && <div className="mt-2 truncate text-xs text-muted-foreground">From {s.pageUrl}</div>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────

export function WebFormsPanel({ businessName, onOpenLead }: { businessName: string; onOpenLead?: (lead: { id: string; name: string }) => void }) {
  const [forms, setForms] = React.useState<WebForm[] | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WebForm | null>(null);
  const [template, setTemplate] = React.useState<(typeof TEMPLATES)[number] | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [sharing, setSharing] = React.useState<WebForm | null>(null);
  const [viewing, setViewing] = React.useState<WebForm | null>(null);
  const [archiving, setArchiving] = React.useState<WebForm | null>(null);
  const [brandColor, setBrandColor] = React.useState<string | null>(null);
  const [editorKey, setEditorKey] = React.useState(0);
  const openEditor = (form: WebForm | null, t: (typeof TEMPLATES)[number] | null) => {
    setEditing(form);
    setTemplate(t);
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  };

  const load = React.useCallback(() => {
    api<{ forms: WebForm[] }>("/api/forms")
      .then((d) => setForms(d.forms))
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Could not load forms.");
        setForms([]);
      });
  }, []);
  React.useEffect(() => {
    load();
    fetch("/api/agent")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrandColor(d?.agent?.brandColor ?? null))
      .catch(() => {});
  }, [load]);

  const visible = (forms ?? []).filter((x) => (showArchived ? x.status === "archived" : x.status === "active"));
  const archivedCount = (forms ?? []).filter((x) => x.status === "archived").length;

  async function setStatus(form: WebForm, status: "active" | "archived") {
    try {
      if (status === "archived") await api(`/api/forms/${form.id}`, { method: "DELETE" });
      else await api(`/api/forms/${form.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(status === "archived" ? `${form.name} archived. Its link and embeds stop working.` : `${form.name} restored.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setArchiving(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList size={15} /> Forms
          </h3>
          <p className="text-xs text-muted-foreground">Contact, quote and sign-up forms for your website, a link or a QR code. Every submission lands in Leads.</p>
        </div>
        <div className="flex items-center gap-2">
          {(archivedCount > 0 || showArchived) && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Show active" : `Archived (${archivedCount})`}
            </Button>
          )}
          <Button size="sm" onClick={() => setPicking(true)}>
            <Plus className="mr-1 h-4 w-4" /> New form
          </Button>
        </div>
      </div>

      {!forms ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{showArchived ? "No archived forms." : "No forms yet"}</p>
          {!showArchived && <p className="mt-1 text-sm text-muted-foreground">Start from a template and change anything you like.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Form</th>
                <th className="py-2 pr-3 text-right font-medium">Submissions</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visible.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {x.fields.length} field{x.fields.length === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <button type="button" className="hover:underline" onClick={() => setViewing(x)}>
                      {x.submissions.toLocaleString()}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{new Date(x.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-1">
                      {x.status === "active" ? (
                        <>
                          <Button variant="outline" size="sm" className="h-8" onClick={() => setSharing(x)}>
                            <Code2 className="mr-1 h-3.5 w-3.5" /> Share
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Submissions for ${x.name}`} title="Submissions" onClick={() => setViewing(x)}>
                            <Inbox className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Edit ${x.name}`}
                            title="Edit"
                            onClick={() => openEditor(x, null)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Archive ${x.name}`} title="Archive" onClick={() => setArchiving(x)}>
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setStatus(x, "active")}>
                          <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New form</DialogTitle>
            <DialogDescription>Pick a starting point.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
                onClick={() => {
                  setPicking(false);
                  openEditor(null, t);
                }}
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <FormEditor
        key={editorKey}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        template={template}
        businessName={businessName}
        brandColor={brandColor}
        onSaved={(saved) => {
          load();
          if (!editing) setSharing({ ...saved, fields: saved.fields ?? [], settings: saved.settings ?? DEFAULT_SETTINGS });
        }}
      />
      <ShareDialog form={sharing} onOpenChange={(o) => !o && setSharing(null)} />
      <SubmissionsDialog key={viewing?.id ?? "none"} form={viewing} onOpenChange={(o) => !o && setViewing(null)} onOpenLead={onOpenLead} onChanged={load} />
      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its page and every embed stop accepting submissions. Past submissions and leads are kept, and you can restore it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiving && setStatus(archiving, "archived")}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
