"use client";

// Leads → Lead magnets (Phase 2, workstream T): free PDFs (a checklist, a
// guide) that visitors get by email in exchange for filling in a form.
// Upload a PDF or have the AI write one, pick the gate form, then share
// the download page or embed it on any website.

import * as React from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ExternalLink, FileText, Loader2, Magnet, Pencil, Plus, Share2, Sparkles, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { FormField } from "@/lib/forms/schema";
import { CopyField } from "@/components/dashboard/views/web-forms-panel";

type Style = "checklist" | "guide";
interface Section {
  heading: string;
  paragraph: string;
  items: string[];
}
interface Content {
  intro: string;
  sections: Section[];
  closing: string;
}
interface LeadMagnet {
  id: string;
  title: string;
  description: string | null;
  bullets: string[];
  kind: "upload" | "ai";
  style: Style | null;
  content: Content | null;
  hasFile: boolean;
  fileName: string | null;
  fileBytes: number | null;
  formId: string | null;
  form: { id: string; name: string; status: string } | null;
  deliveryEmail: { subject: string | null; intro: string | null };
  downloads: number;
  signups?: number;
  status: "draft" | "published";
}
interface GateForm {
  id: string;
  name: string;
  status: string;
  fields: FormField[];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const r = await fetch(url, { cache: "no-store", ...init, headers: isForm ? init?.headers : { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 403 ? "Only owners and admins can change lead magnets." : "Something went wrong."));
  return d as T;
}

const collectsEmail = (f: GateForm) => f.fields.some((x) => x.mapTo === "email" && x.required);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const kb = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

// ─── New lead magnet ────────────────────────────────────────────────

function NewDialog({ open, onOpenChange, forms, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; forms: GateForm[]; onCreated: (m: LeadMagnet) => void }) {
  const [mode, setMode] = React.useState<"ai" | "upload">("ai");
  const [prompt, setPrompt] = React.useState("");
  const [style, setStyle] = React.useState<Style>("checklist");
  const [title, setTitle] = React.useState("");
  const [formId, setFormId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const usable = forms.filter((f) => f.status === "active");

  async function create() {
    setBusy(true);
    try {
      const d =
        mode === "ai"
          ? await api<{ magnet: LeadMagnet }>("/api/lead-magnets/generate", { method: "POST", body: JSON.stringify({ prompt, style, formId: formId || undefined }) })
          : await api<{ magnet: LeadMagnet }>("/api/lead-magnets", { method: "POST", body: JSON.stringify({ title, kind: "upload", formId: formId || undefined }) });
      toast.success(mode === "ai" ? "Written. Check it over, then publish." : "Created. Upload the PDF next.");
      onCreated(d.magnet);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lead magnet</DialogTitle>
          <DialogDescription>A free PDF people get by email after filling in one of your forms.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to make it">
            {(
              [
                { v: "ai", icon: Sparkles, label: "Write it with AI", hint: "A checklist or short guide" },
                { v: "upload", icon: Upload, label: "Upload a PDF", hint: "Up to 10 MB" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={mode === o.v}
                onClick={() => setMode(o.v)}
                className={`rounded-lg border p-3 text-left transition-colors ${mode === o.v ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
              >
                <o.icon className="mb-1 h-4 w-4" aria-hidden />
                <div className="text-sm font-medium">{o.label}</div>
                <div className="text-xs text-muted-foreground">{o.hint}</div>
              </button>
            ))}
          </div>
          {mode === "ai" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="lm-prompt">What should it cover?</Label>
                <Textarea id="lm-prompt" rows={3} maxLength={1500} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="10 things to check before replacing your roof, for homeowners" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lm-style">Format</Label>
                <Select value={style} onValueChange={(v) => setStyle(v as Style)}>
                  <SelectTrigger id="lm-style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checklist">Checklist</SelectItem>
                    <SelectItem value="guide">Short guide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Uses 1 AI credit. It follows your brand voice and only states facts from your knowledge base.</p>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="lm-title">Title</Label>
              <Input id="lm-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The homeowner's roofing checklist" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lm-form">Gate form</Label>
            <Select value={formId || "__none"} onValueChange={(v) => setFormId(v === "__none" ? "" : v)}>
              <SelectTrigger id="lm-form">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Choose later</SelectItem>
                {usable.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                    {collectsEmail(f) ? "" : " (no email field)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || (mode === "ai" ? prompt.trim().length < 10 : !title.trim())}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {mode === "ai" ? (busy ? "Writing…" : "Write it") : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────

function SectionEditor({ s, i, count, onChange, onMove, onRemove, style }: { s: Section; i: number; count: number; onChange: (s: Section) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; style: Style }) {
  const [items, setItems] = React.useState(s.items.join("\n"));
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="sr-only">Section {i + 1}</legend>
      <div className="flex items-center gap-2">
        <Input aria-label={`Section ${i + 1} heading`} maxLength={160} value={s.heading} onChange={(e) => onChange({ ...s, heading: e.target.value })} placeholder="Heading" className="font-medium" />
        <Button type="button" variant="ghost" size="icon" aria-label="Move section up" disabled={i === 0} onClick={() => onMove(-1)}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Move section down" disabled={i === count - 1} onClick={() => onMove(1)}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove section" disabled={count === 1} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea aria-label={`Section ${i + 1} text`} rows={2} maxLength={2000} value={s.paragraph} onChange={(e) => onChange({ ...s, paragraph: e.target.value })} placeholder="Short explanation (optional)" />
      <Textarea
        aria-label={`Section ${i + 1} ${style === "checklist" ? "checklist items" : "key points"}, one per line`}
        rows={Math.min(8, Math.max(3, s.items.length + 1))}
        value={items}
        onChange={(e) => {
          setItems(e.target.value);
          onChange({ ...s, items: lines(e.target.value).map((x) => x.slice(0, 400)).slice(0, 25) });
        }}
        placeholder={style === "checklist" ? "One checklist item per line" : "One key point per line"}
      />
    </fieldset>
  );
}

function EditorDialog({ magnet, forms, onOpenChange, onSaved }: { magnet: LeadMagnet; forms: GateForm[]; onOpenChange: (v: boolean) => void; onSaved: (m: LeadMagnet) => void }) {
  // Remounted per magnet by the parent (key), so state starts from the props.
  const [title, setTitle] = React.useState(magnet.title);
  const [description, setDescription] = React.useState(magnet.description ?? "");
  const [bullets, setBullets] = React.useState(magnet.bullets.join("\n"));
  const [formId, setFormId] = React.useState(magnet.formId ?? "");
  const [subject, setSubject] = React.useState(magnet.deliveryEmail.subject ?? "");
  const [intro, setIntro] = React.useState(magnet.deliveryEmail.intro ?? "");
  const [style, setStyle] = React.useState<Style>(magnet.style ?? "checklist");
  const [content, setContent] = React.useState<Content | null>(magnet.content);
  // Section editors keep their own text; a new key remounts them after a move.
  const [sectionKeys, setSectionKeys] = React.useState(() => (magnet.content?.sections ?? []).map((_, i) => `s${i}`));
  const [file, setFile] = React.useState<{ name: string | null; bytes: number | null; has: boolean }>({ name: magnet.fileName, bytes: magnet.fileBytes, has: magnet.hasFile });
  const [busy, setBusy] = React.useState<null | "save" | "publish" | "upload">(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const gate = forms.find((f) => f.id === formId);
  const nextKey = React.useRef(sectionKeys.length);

  const setSections = (fn: (s: Section[]) => Section[]) => setContent((c) => (c ? { ...c, sections: fn(c.sections) } : c));
  const move = (i: number, d: -1 | 1) => {
    setSections((s) => {
      const out = [...s];
      [out[i], out[i + d]] = [out[i + d], out[i]];
      return out;
    });
    setSectionKeys((k) => {
      const out = [...k];
      [out[i], out[i + d]] = [out[i + d], out[i]];
      return out;
    });
  };

  async function upload(f: File) {
    if (f.size > 10 * 1024 * 1024) return toast.error("PDFs can be up to 10 MB.");
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const d = await api<{ magnet: LeadMagnet }>(`/api/lead-magnets/${magnet.id}/file`, { method: "POST", body: fd });
      setFile({ name: d.magnet.fileName, bytes: d.magnet.fileBytes, has: d.magnet.hasFile });
      toast.success("PDF uploaded.");
      onSaved(d.magnet);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(publish: boolean) {
    setBusy(publish ? "publish" : "save");
    try {
      const body: Record<string, unknown> = {
        title,
        description,
        bullets: lines(bullets),
        formId: formId || null,
        deliveryEmail: { subject, intro },
        ...(magnet.kind === "ai" && content ? { content, style } : {}),
        ...(publish ? { status: "published" } : {}),
      };
      const d = await api<{ magnet: LeadMagnet; problems: string[] }>(`/api/lead-magnets/${magnet.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(publish ? "Published. Share the page or embed it." : magnet.kind === "ai" ? "Saved, and the PDF was updated." : "Saved.");
      onSaved(d.magnet);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit lead magnet</DialogTitle>
          <DialogDescription>{magnet.kind === "ai" ? "Edit the text; the PDF is rebuilt when you save." : "The download page shows the title, description and points next to the form."}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lme-title">Title</Label>
              <Input id="lme-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lme-desc">Description</Label>
              <Textarea id="lme-desc" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it's for and what they get" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lme-bullets">What they get (one point per line, up to 6)</Label>
              <Textarea id="lme-bullets" rows={3} value={bullets} onChange={(e) => setBullets(e.target.value)} />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold">The PDF</h4>
            {magnet.kind === "upload" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">{file.has ? `${file.name} · ${kb(file.bytes)}` : <span className="text-muted-foreground">No PDF yet</span>}</div>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" id="lme-file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                  {busy === "upload" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Upload className="mr-2 h-4 w-4" aria-hidden />}
                  {file.has ? "Replace PDF" : "Upload PDF"}
                </Button>
                {file.has && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api/lead-magnets/${magnet.id}/file`} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-4 w-4" aria-hidden /> Preview
                    </a>
                  </Button>
                )}
              </div>
            ) : content ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="lme-style">Format</Label>
                    <Select value={style} onValueChange={(v) => setStyle(v as Style)}>
                      <SelectTrigger id="lme-style" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checklist">Checklist</SelectItem>
                        <SelectItem value="guide">Short guide</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {file.has && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/api/lead-magnets/${magnet.id}/file`} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1 h-4 w-4" aria-hidden /> Preview saved PDF
                      </a>
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lme-intro">Introduction</Label>
                  <Textarea id="lme-intro" rows={2} maxLength={2000} value={content.intro} onChange={(e) => setContent({ ...content, intro: e.target.value })} />
                </div>
                {content.sections.map((s, i) => (
                  <SectionEditor
                    key={sectionKeys[i]}
                    s={s}
                    i={i}
                    count={content.sections.length}
                    style={style}
                    onChange={(ns) => setSections((all) => all.map((x, j) => (j === i ? ns : x)))}
                    onMove={(d) => move(i, d)}
                    onRemove={() => {
                      setSections((all) => all.filter((_, j) => j !== i));
                      setSectionKeys((k) => k.filter((_, j) => j !== i));
                    }}
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={content.sections.length >= 15}
                  onClick={() => {
                    setSections((all) => [...all, { heading: "", paragraph: "", items: [] }]);
                    setSectionKeys((k) => [...k, `s${nextKey.current++}`]);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden /> Add section
                </Button>
                <div className="space-y-1.5">
                  <Label htmlFor="lme-closing">Closing line</Label>
                  <Textarea id="lme-closing" rows={2} maxLength={1000} value={content.closing} onChange={(e) => setContent({ ...content, closing: e.target.value })} />
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold">Gate and delivery</h4>
            <div className="space-y-1.5">
              <Label htmlFor="lme-form">Gate form</Label>
              <Select value={formId || "__none"} onValueChange={(v) => setFormId(v === "__none" ? "" : v)}>
                <SelectTrigger id="lme-form">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {forms
                    .filter((f) => f.status === "active" || f.id === formId)
                    .map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {gate && !collectsEmail(gate) && (
                <p className="text-xs text-destructive" role="alert">
                  This form has no required field mapped to Email, so there&apos;s nowhere to send the link. Edit the form in Leads → Forms.
                </p>
              )}
              <p className="text-xs text-muted-foreground">People fill in this form, become leads and get a download link by email. The link works for 7 days.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lme-subject">Email subject</Label>
              <Input id="lme-subject" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`Your download: ${title || "…"}`} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lme-email-intro">Email message</Label>
              <Textarea id="lme-email-intro" rows={2} maxLength={1000} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder={`Hi Sam, thanks for your interest. Here is your copy of "${title || "…"}".`} />
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={!!busy || !title.trim()}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Save
          </Button>
          {magnet.status !== "published" && (
            <Button onClick={() => save(true)} disabled={!!busy || !title.trim()}>
              {busy === "publish" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Save and publish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Share ──────────────────────────────────────────────────────────

function ShareDialog({ magnet, onOpenChange }: { magnet: LeadMagnet | null; onOpenChange: (v: boolean) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = magnet ? `${origin}/m/${magnet.id}` : "";
  const embed = magnet ? `<div data-danets-magnet="${magnet.id}"></div>\n<script src="${origin}/forms.js" async></script>` : "";
  return (
    <Dialog open={!!magnet} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {magnet?.title}</DialogTitle>
          <DialogDescription>Link to the download page, or put the offer and its form on your website.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <CopyField label="Link" value={link} />
          <CopyField label="Embed code" value={embed} multiline />
          <p className="text-xs text-muted-foreground">Already using the chat widget? Just add the &lt;div&gt;; the widget loads it.</p>
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

// ─── Panel ──────────────────────────────────────────────────────────

export function LeadMagnetsPanel() {
  const [magnets, setMagnets] = React.useState<LeadMagnet[] | null>(null);
  const [forms, setForms] = React.useState<GateForm[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [newKey, setNewKey] = React.useState(0);
  const [editing, setEditing] = React.useState<LeadMagnet | null>(null);
  const [editorKey, setEditorKey] = React.useState(0);
  const [sharing, setSharing] = React.useState<LeadMagnet | null>(null);
  const [deleting, setDeleting] = React.useState<LeadMagnet | null>(null);

  const load = React.useCallback(() => {
    api<{ magnets: LeadMagnet[] }>("/api/lead-magnets")
      .then((d) => setMagnets(d.magnets))
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Could not load lead magnets.");
        setMagnets([]);
      });
    api<{ forms: GateForm[] }>("/api/forms")
      .then((d) => setForms(d.forms))
      .catch(() => setForms([]));
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  const edit = (m: LeadMagnet) => {
    setEditing(m);
    setEditorKey((k) => k + 1);
  };

  async function setStatus(m: LeadMagnet, status: "draft" | "published") {
    try {
      await api(`/api/lead-magnets/${m.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(status === "published" ? `${m.title} is live.` : `${m.title} unpublished. Its page and embeds stop working; links already emailed still work.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    }
    load();
  }

  async function remove(m: LeadMagnet) {
    try {
      await api(`/api/lead-magnets/${m.id}`, { method: "DELETE" });
      toast.success(`${m.title} deleted.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Magnet size={15} /> Lead magnets
          </h3>
          <p className="text-xs text-muted-foreground">Free checklists and guides people get by email for filling in a form. Each request becomes a lead.</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setNewKey((k) => k + 1);
            setCreating(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> New lead magnet
        </Button>
      </div>

      {!magnets ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : magnets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Magnet className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No lead magnets yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Offer something useful, like a checklist or a buyer&apos;s guide, in exchange for an email address. The AI can write one for you.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {magnets.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                {m.kind === "ai" ? <Sparkles className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.title}</span>
                  <Badge variant={m.status === "published" ? "default" : "secondary"}>{m.status === "published" ? "Live" : "Draft"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.kind === "ai" ? "AI-written" : "Uploaded PDF"} · {m.form ? `Form: ${m.form.name}` : "No gate form"} · {m.signups ?? 0} request{m.signups === 1 ? "" : "s"} · {m.downloads} download{m.downloads === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {m.status === "published" ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setSharing(m)}>
                      <Share2 className="mr-1 h-4 w-4" aria-hidden /> Share
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setStatus(m, "draft")}>
                      Unpublish
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setStatus(m, "published")}>
                    Publish
                  </Button>
                )}
                <Button variant="ghost" size="icon" aria-label={`Edit ${m.title}`} onClick={() => edit(m)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${m.title}`} onClick={() => setDeleting(m)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewDialog
        key={newKey}
        open={creating}
        onOpenChange={setCreating}
        forms={forms}
        onCreated={(m) => {
          setCreating(false);
          load();
          edit(m);
        }}
      />
      {editing && (
        <EditorDialog
          key={editorKey}
          magnet={editing}
          forms={forms}
          onOpenChange={(v) => !v && setEditing(null)}
          onSaved={() => load()}
        />
      )}
      <ShareDialog magnet={sharing} onOpenChange={(v) => !v && setSharing(null)} />
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.title}?</AlertDialogTitle>
            <AlertDialogDescription>The PDF is deleted and download links already emailed stop working. Leads it brought in are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove(deleting)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
