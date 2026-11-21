"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, Plus, Save, Sparkles, Trash2, Wand2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BRAND_LIMITS, normalizeBrandProfile, type BrandProfileInput } from "@/lib/brand-schema";

interface BrandView {
  profile: BrandProfileInput;
  source: string;
  generatedAt: string | null;
  generationStatus: string;
  generationError: string | null;
}

/** Editable form state: list fields are kept as text so typing feels natural. */
interface FormState {
  summary: string;
  adjectives: string;
  formality: number;
  emoji: boolean;
  audience: { segment: string; pains: string; desires: string }[];
  valueProps: string;
  offers: { name: string; price: string; cta: string; url: string }[];
  doPhrases: string;
  dontPhrases: string;
  locales: string;
  websiteUrl: string;
}

const lines = (s: string) => s.split("\n");
const commas = (s: string) => s.split(",");

function toForm(p: BrandProfileInput): FormState {
  return {
    summary: p.summary ?? "",
    adjectives: p.tone.adjectives.join(", "),
    formality: p.tone.formality,
    emoji: p.tone.emoji,
    audience: p.audience.map((a) => ({ segment: a.segment, pains: a.pains.join("\n"), desires: a.desires.join("\n") })),
    valueProps: p.valueProps.join("\n"),
    offers: p.offers.map((o) => ({ name: o.name, price: o.price ?? "", cta: o.cta, url: o.url ?? "" })),
    doPhrases: p.doPhrases.join("\n"),
    dontPhrases: p.dontPhrases.join("\n"),
    locales: p.locales.join(", "),
    websiteUrl: p.websiteUrl ?? "",
  };
}

function toProfile(f: FormState): BrandProfileInput {
  return normalizeBrandProfile({
    summary: f.summary,
    tone: { adjectives: commas(f.adjectives), formality: f.formality, emoji: f.emoji },
    audience: f.audience.map((a) => ({ segment: a.segment, pains: lines(a.pains), desires: lines(a.desires) })),
    valueProps: lines(f.valueProps),
    offers: f.offers.map((o) => ({ name: o.name, price: o.price, cta: o.cta, url: o.url })),
    doPhrases: lines(f.doPhrases),
    dontPhrases: lines(f.dontPhrases),
    locales: commas(f.locales),
    websiteUrl: f.websiteUrl,
  });
}

const FORMALITY_LABEL = ["", "Very casual", "Casual", "Conversational", "Professional", "Formal"];
const SOURCE_LABEL: Record<string, string> = { generated: "Drafted by AI", edited: "AI draft, edited", manual: "Written by you" };
const CHANNELS = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

/** Settings → Brand Voice: the profile every AI content generator writes in. */
export function BrandVoiceCard() {
  const [brand, setBrand] = useState<BrandView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [kbCount, setKbCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [channel, setChannel] = useState("facebook");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const busy = brand?.generationStatus === "queued" || brand?.generationStatus === "running";

  const apply = useCallback((b: BrandView, resetForm: boolean) => {
    setBrand(b);
    if (resetForm) setForm(toForm(b.profile));
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ brand: BrandView; canEdit: boolean; kbCount: number }>("/api/brand-profile");
      apply(d.brand, true);
      setCanEdit(d.canEdit);
      setKbCount(d.kbCount);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load brand voice");
    }
  }, [apply]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // While a draft is being generated, poll until it finishes.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      try {
        const d = await api<{ brand: BrandView }>("/api/brand-profile");
        const done = d.brand.generationStatus !== "queued" && d.brand.generationStatus !== "running";
        apply(d.brand, done && d.brand.generationStatus === "idle");
        if (done && d.brand.generationStatus === "idle") toast.success("Brand voice drafted. Review it before saving changes.");
        if (d.brand.generationStatus === "failed") toast.error(d.brand.generationError || "Generation failed");
      } catch {
        // keep polling
      }
    }, 4000);
    return () => clearInterval(t);
  }, [busy, apply]);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const d = await api<{ brand: BrandView }>("/api/brand-profile", {
        method: "PUT",
        body: JSON.stringify({ profile: toProfile(form) }),
      });
      apply(d.brand, true);
      toast.success("Brand voice saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setConfirmGenerate(false);
    try {
      const d = await api<{ brand: BrandView }>("/api/brand-profile/generate", { method: "POST" });
      apply(d.brand, false);
      toast.message("Drafting your brand voice", { description: "This runs in the background and usually takes under a minute." });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not start generation");
    }
  }

  async function runPreview() {
    if (!form) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const d = await api<{ post: string }>("/api/brand-profile/preview", {
        method: "POST",
        body: JSON.stringify({ channel, draft: toProfile(form) }),
      });
      setPreview(d.post);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (!form || !brand) {
    return (
      <Card>
        <CardContent className="py-6">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const hasProfile = !!brand.profile.summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Megaphone size={16} /> Brand Voice
          {hasProfile && (
            <Badge variant="secondary" className="text-xs font-normal">
              {SOURCE_LABEL[brand.source] ?? brand.source}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          How your business sounds. Every AI-written post, ad and email follows this profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {canEdit && (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {kbCount > 0
                ? `Draft it with AI from your ${kbCount} knowledge base article${kbCount === 1 ? "" : "s"}, then edit.`
                : "Add knowledge base articles to draft your brand voice with AI."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={busy || kbCount === 0}
              onClick={() => (hasProfile ? setConfirmGenerate(true) : generate())}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {busy ? "Drafting…" : "Generate from my knowledge base"}
            </Button>
          </div>
        )}
        {brand.generationStatus === "failed" && brand.generationError && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {brand.generationError}
          </div>
        )}

        <fieldset disabled={!canEdit || busy} className="space-y-5 disabled:opacity-80">
          <div className="space-y-1.5">
            <Label htmlFor="bv-summary">Who you are</Label>
            <Textarea
              id="bv-summary"
              rows={3}
              maxLength={BRAND_LIMITS.summary}
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              placeholder="One paragraph: what you sell, to whom, and what makes you different."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bv-adjectives">Voice, in a few words</Label>
              <Input
                id="bv-adjectives"
                value={form.adjectives}
                onChange={(e) => set("adjectives", e.target.value)}
                placeholder="warm, expert, straightforward"
              />
              <p className="text-xs text-muted-foreground">Comma-separated, up to {BRAND_LIMITS.adjectives}.</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Formality</Label>
                <span className="text-xs text-muted-foreground">{FORMALITY_LABEL[form.formality]}</span>
              </div>
              <Slider min={1} max={5} step={1} value={[form.formality]} onValueChange={([v]) => set("formality", v)} />
              <div className="flex items-center justify-between">
                <Label htmlFor="bv-emoji">Emoji in posts</Label>
                <Switch id="bv-emoji" checked={form.emoji} onCheckedChange={(v) => set("emoji", v)} />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Audience</Label>
              {form.audience.length < BRAND_LIMITS.audience && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => set("audience", [...form.audience, { segment: "", pains: "", desires: "" }])}
                >
                  <Plus className="size-4" /> Add segment
                </Button>
              )}
            </div>
            {form.audience.length === 0 && <p className="text-xs text-muted-foreground">Who you sell to. Add a segment.</p>}
            {form.audience.map((a, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex gap-2">
                  <Input
                    value={a.segment}
                    onChange={(e) => set("audience", form.audience.map((x, j) => (j === i ? { ...x, segment: e.target.value } : x)))}
                    placeholder="Segment, e.g. small clinic owners in Lagos"
                    aria-label="Segment"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove segment"
                    onClick={() => set("audience", form.audience.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Textarea
                    rows={3}
                    value={a.pains}
                    onChange={(e) => set("audience", form.audience.map((x, j) => (j === i ? { ...x, pains: e.target.value } : x)))}
                    placeholder={"Pains, one per line"}
                    aria-label="Pains"
                  />
                  <Textarea
                    rows={3}
                    value={a.desires}
                    onChange={(e) => set("audience", form.audience.map((x, j) => (j === i ? { ...x, desires: e.target.value } : x)))}
                    placeholder={"What they want, one per line"}
                    aria-label="Desires"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bv-values">Why customers choose you</Label>
            <Textarea
              id="bv-values"
              rows={3}
              value={form.valueProps}
              onChange={(e) => set("valueProps", e.target.value)}
              placeholder="One per line"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Offers</Label>
              {form.offers.length < BRAND_LIMITS.offers && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => set("offers", [...form.offers, { name: "", price: "", cta: "", url: "" }])}
                >
                  <Plus className="size-4" /> Add offer
                </Button>
              )}
            </div>
            {form.offers.map((o, i) => {
              const upd = (patch: Partial<FormState["offers"][number]>) =>
                set("offers", form.offers.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_8rem_auto]">
                  <Input value={o.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Offer name" aria-label="Offer name" />
                  <Input value={o.price} onChange={(e) => upd({ price: e.target.value })} placeholder="Price (optional)" aria-label="Price" />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove offer"
                    onClick={() => set("offers", form.offers.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Input value={o.cta} onChange={(e) => upd({ cta: e.target.value })} placeholder="Call to action, e.g. Book a free consult" aria-label="Call to action" />
                  <Input
                    className="sm:col-span-2"
                    value={o.url}
                    onChange={(e) => upd({ url: e.target.value })}
                    placeholder="https://… (optional)"
                    aria-label="Offer link"
                  />
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bv-do">Phrases to use</Label>
              <Textarea id="bv-do" rows={3} value={form.doPhrases} onChange={(e) => set("doPhrases", e.target.value)} placeholder="One per line" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bv-dont">Never say</Label>
              <Textarea
                id="bv-dont"
                rows={3}
                value={form.dontPhrases}
                onChange={(e) => set("dontPhrases", e.target.value)}
                placeholder="One per line, e.g. cheap, guaranteed results"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bv-locales">Languages</Label>
              <Input id="bv-locales" value={form.locales} onChange={(e) => set("locales", e.target.value)} placeholder="en-NG, fr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bv-url">Website</Label>
              <Input id="bv-url" type="url" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" />
            </div>
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-[130px]" size="sm" aria-label="Preview channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={runPreview} disabled={previewing || busy || !form.summary.trim()}>
              {previewing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Preview a sample post
            </Button>
          </div>
          {canEdit && (
            <Button onClick={save} disabled={saving || busy}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save brand voice
            </Button>
          )}
        </div>
        {preview && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              Sample {CHANNELS.find((c) => c.id === channel)?.label} post (not published, uses your unsaved edits)
            </div>
            <p className="text-sm whitespace-pre-wrap break-words">{preview}</p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your brand voice with an AI draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft overwrites the current profile, including unsaved edits. You can edit it again afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={generate}>Generate draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
