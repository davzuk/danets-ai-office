"use client";

// Leads → Bookings → Booking types (Phase 2, workstream P): what visitors can
// book, the weekly hours for each, and the business timezone those hours are in.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COMMON_TIMEZONES } from "@/lib/content/timezone";
import { DEFAULT_AVAILABILITY, LOCATION_LABEL, type Availability, type Weekday } from "@/lib/booking/slots";

interface Question {
  key: string;
  label: string;
  required: boolean;
}

interface BookingType {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  slotStepMin: number;
  availability: Availability;
  location: "phone" | "video" | "in_person" | "custom";
  locationDetail: string | null;
  questions: Question[] | null;
  assignedUserId: string | null;
  active: boolean;
}

interface TypesData {
  types: BookingType[];
  timezone: string;
  bookingBaseUrl: string;
  users: { id: string; name: string; email: string }[];
  canEdit: boolean;
  limit: { used: number; limit: number };
}

type Draft = Omit<BookingType, "id" | "questions"> & { id?: string; questions: Question[] };

const DAY_LABEL: Record<Weekday, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const DAY_ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const keyify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "question";

/** Keys are how answers are stored, so each must be valid and distinct. */
function uniqueKeys(list: Question[]): Question[] {
  const seen = new Set<string>();
  return list.map((q) => {
    const base = /^[a-z0-9_]{1,40}$/.test(q.key) ? q.key : keyify(q.label);
    let key = base;
    for (let n = 2; seen.has(key); n++) key = `${base.slice(0, 36)}_${n}`;
    seen.add(key);
    return { ...q, label: q.label.trim(), key };
  });
}

function emptyDraft(): Draft {
  return {
    name: "",
    slug: "",
    description: "",
    durationMin: 30,
    bufferMin: 0,
    minNoticeHours: 4,
    maxDaysAhead: 30,
    slotStepMin: 30,
    availability: structuredClone(DEFAULT_AVAILABILITY),
    location: "phone",
    locationDetail: "",
    questions: [],
    assignedUserId: null,
    active: true,
  };
}

export function BookingTypesPanel() {
  const [data, setData] = useState<TypesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<BookingType | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/booking-types", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load booking types.");
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function toggleActive(t: BookingType, active: boolean) {
    const r = await fetch(`/api/booking-types/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "Could not update the booking type.");
    toast.success(active ? `"${t.name}" can be booked again.` : `"${t.name}" is hidden from visitors.`);
    load();
  }

  async function remove(t: BookingType) {
    const r = await fetch(`/api/booking-types/${t.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setDeleting(null);
    if (!r.ok) return toast.error(d.error || "Could not delete the booking type.");
    toast.success(`Deleted "${t.name}".`);
    load();
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data)
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );

  const atLimit = data.limit.limit > 0 && data.limit.used >= data.limit.limit;
  const link = (t: BookingType) => `${data.bookingBaseUrl}/${t.slug}`;

  return (
    <div className="space-y-4">
      <TimezoneSetting timezone={data.timezone} canEdit={data.canEdit} onSaved={load} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data.limit.limit > 0 ? `${data.limit.used} of ${data.limit.limit} booking types used.` : `${data.limit.used} booking types.`}
          {" "}
          <a className="text-primary hover:underline" href={data.bookingBaseUrl} target="_blank" rel="noreferrer">
            View your booking page
          </a>
        </p>
        {data.canEdit && (
          <Button size="sm" disabled={atLimit} title={atLimit ? "Your plan's limit is reached. Upgrade for more booking types." : undefined} onClick={() => setDraft(emptyDraft())}>
            <Plus className="h-4 w-4" /> New booking type
          </Button>
        )}
      </div>

      {data.types.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No booking types yet. Create one, such as a 30-minute consultation, and share its link or let the chat widget offer it.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.types.map((t) => (
            <li key={t.id} className="rounded-lg border p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  {!t.active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Hidden
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.durationMin} min · {LOCATION_LABEL[t.location] ?? t.location}
                  {t.assignedUserId ? ` · ${data.users.find((u) => u.id === t.assignedUserId)?.name ?? "Team member"}` : ""}
                </p>
                <p className="text-xs text-muted-foreground truncate">{link(t)}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Copy link for ${t.name}`}
                  onClick={() => navigator.clipboard.writeText(link(t)).then(() => toast.success("Link copied."), () => toast.error("Could not copy the link."))}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Open ${t.name}`} asChild>
                  <a href={link(t)} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                {data.canEdit && (
                  <>
                    <Switch checked={t.active} onCheckedChange={(v) => toggleActive(t, v)} aria-label={`${t.name} can be booked`} />
                    <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setDraft({ ...t, description: t.description ?? "", locationDetail: t.locationDetail ?? "", questions: t.questions ?? [] })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <TypeEditor
          draft={draft}
          users={data.users}
          timezone={data.timezone}
          baseUrl={data.bookingBaseUrl}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            load();
          }}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete &quot;{deleting?.name}&quot;?</DialogTitle>
            <DialogDescription>Its link stops working. Past bookings stay in your list. A type with upcoming bookings can&apos;t be deleted; hide it instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => deleting && remove(deleting)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimezoneSetting({ timezone, canEdit, onSaved }: { timezone: string; canEdit: boolean; onSaved: () => void }) {
  const zones = useMemo(() => [...new Set([timezone, ...COMMON_TIMEZONES])], [timezone]);
  const [saving, setSaving] = useState(false);
  async function save(tz: string) {
    setSaving(true);
    try {
      const r = await fetch("/api/booking-types/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: tz }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not save the time zone.");
      toast.success(`Booking hours are now in ${tz}.`);
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3">
      <Label htmlFor="bk-tz" className="text-sm">
        Business time zone
      </Label>
      <Select value={timezone} onValueChange={save} disabled={!canEdit || saving}>
        <SelectTrigger id="bk-tz" className="w-56 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {zones.map((z) => (
            <SelectItem key={z} value={z}>
              {z}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">Weekly hours are in this zone. Visitors see times in their own.</span>
    </div>
  );
}

function NumberField({ id, label, value, onChange, min, max, suffix }: { id: string; label: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(parseInt(e.target.value, 10))} className="h-9" />
        <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>
      </div>
    </div>
  );
}

function TypeEditor({
  draft: initial,
  users,
  timezone,
  baseUrl,
  onClose,
  onSaved,
}: {
  draft: Draft;
  users: TypesData["users"];
  timezone: string;
  baseUrl: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [slugEdited, setSlugEdited] = useState(!!initial.id);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const setDay = (day: Weekday, list: [string, string][]) => setD((p) => ({ ...p, availability: { ...p.availability, [day]: list } }));

  async function save() {
    setSaving(true);
    try {
      const body = {
        name: d.name,
        slug: d.slug,
        description: d.description?.trim() || null,
        durationMin: d.durationMin,
        bufferMin: d.bufferMin,
        minNoticeHours: d.minNoticeHours,
        maxDaysAhead: d.maxDaysAhead,
        slotStepMin: d.slotStepMin,
        availability: d.availability,
        location: d.location,
        locationDetail: d.locationDetail?.trim() || null,
        questions: uniqueKeys(d.questions.filter((q) => q.label.trim())),
        assignedUserId: d.assignedUserId,
        active: d.active,
      };
      const r = await fetch(d.id ? `/api/booking-types/${d.id}` : "/api/booking-types", {
        method: d.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "Could not save the booking type.");
      toast.success(d.id ? "Booking type saved." : "Booking type created.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const openDays = DAY_ORDER.filter((day) => d.availability[day].length > 0).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d.id ? `Edit "${initial.name}"` : "New booking type"}</DialogTitle>
          <DialogDescription>What visitors book, when you're available, and what to ask them.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bt-name">Name</Label>
              <Input
                id="bt-name"
                maxLength={80}
                placeholder="30-minute consultation"
                value={d.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setD((p) => ({ ...p, name, slug: slugEdited ? p.slug : slugify(name) }));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bt-slug">Link</Label>
              <Input
                id="bt-slug"
                maxLength={80}
                value={d.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
              />
              <p className="text-xs text-muted-foreground truncate">
                {baseUrl}/{d.slug || "…"}
              </p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="bt-desc">Description (shown to visitors)</Label>
              <Textarea id="bt-desc" rows={2} maxLength={1000} value={d.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </div>
          </section>

          <section className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            <NumberField id="bt-dur" label="Length" value={d.durationMin} onChange={(n) => set("durationMin", n)} min={5} max={480} suffix="min" />
            <NumberField id="bt-step" label="Start times every" value={d.slotStepMin} onChange={(n) => set("slotStepMin", n)} min={5} max={240} suffix="min" />
            <NumberField id="bt-buf" label="Gap between meetings" value={d.bufferMin} onChange={(n) => set("bufferMin", n)} min={0} max={240} suffix="min" />
            <NumberField id="bt-notice" label="Minimum notice" value={d.minNoticeHours} onChange={(n) => set("minNoticeHours", n)} min={0} max={720} suffix="hours" />
            <NumberField id="bt-ahead" label="Bookable up to" value={d.maxDaysAhead} onChange={(n) => set("maxDaysAhead", n)} min={1} max={365} suffix="days ahead" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bt-loc">Where</Label>
              <Select value={d.location} onValueChange={(v) => set("location", v as Draft["location"])}>
                <SelectTrigger id="bt-loc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LOCATION_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bt-locd">Details (sent after booking)</Label>
              <Input
                id="bt-locd"
                maxLength={500}
                placeholder={d.location === "video" ? "Meeting link" : d.location === "in_person" ? "Address" : d.location === "phone" ? "We'll call the number you give" : "Instructions"}
                value={d.locationDetail ?? ""}
                onChange={(e) => set("locationDetail", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bt-user">Who takes it</Label>
              <Select value={d.assignedUserId ?? "none"} onValueChange={(v) => set("assignedUserId", v === "none" ? null : v)}>
                <SelectTrigger id="bt-user">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Anyone on the team</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">They get the notification and the booking email.</p>
            </div>
          </section>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">Weekly hours</h3>
              <p className="text-xs text-muted-foreground">In {timezone}. A meeting and its gap must fit inside these hours.</p>
            </div>
            {DAY_ORDER.map((day) => {
              const list = d.availability[day];
              return (
                <div key={day} className="flex flex-wrap items-start gap-3 border-b pb-2 last:border-0">
                  <label className="flex items-center gap-2 w-32 pt-1.5 text-sm">
                    <Checkbox checked={list.length > 0} onCheckedChange={(c) => setDay(day, c ? [["09:00", "17:00"]] : [])} />
                    {DAY_LABEL[day]}
                  </label>
                  <div className="flex-1 space-y-1.5">
                    {list.length === 0 && <p className="pt-1.5 text-sm text-muted-foreground">Unavailable</p>}
                    {list.map(([a, b], i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${DAY_LABEL[day]} start ${i + 1}`}
                          className="h-8 w-28"
                          value={a}
                          onChange={(e) => setDay(day, list.map((iv, j) => (j === i ? [e.target.value, iv[1]] : iv)))}
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          type="time"
                          aria-label={`${DAY_LABEL[day]} end ${i + 1}`}
                          className="h-8 w-28"
                          value={b === "24:00" ? "23:59" : b}
                          onChange={(e) => setDay(day, list.map((iv, j) => (j === i ? [iv[0], e.target.value] : iv)))}
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove these hours" onClick={() => setDay(day, list.filter((_, j) => j !== i))}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {list.length > 0 && list.length < 4 && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => {
                          const last = list[list.length - 1][1];
                          setDay(day, [...list, [last, last < "20:00" ? "20:00" : "23:59"]]);
                        }}
                      >
                        Add hours
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {openDays === 0 && <p className="text-xs text-destructive">Choose at least one day, or visitors won&apos;t see any times.</p>}
          </section>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">Questions</h3>
              <p className="text-xs text-muted-foreground">Name, email and phone are always asked. Add up to 5 more.</p>
            </div>
            {d.questions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Question ${i + 1}`}
                  maxLength={120}
                  placeholder="What would you like to discuss?"
                  value={q.label}
                  onChange={(e) =>
                    set(
                      "questions",
                      d.questions.map((x, j) => (j === i ? { ...x, label: e.target.value, key: x.key && initial.questions.some((o) => o.key === x.key) ? x.key : keyify(e.target.value) } : x))
                    )
                  }
                />
                <label className="flex items-center gap-1.5 text-sm shrink-0">
                  <Checkbox checked={q.required} onCheckedChange={(c) => set("questions", d.questions.map((x, j) => (j === i ? { ...x, required: !!c } : x)))} />
                  Required
                </label>
                <Button variant="ghost" size="icon" aria-label="Remove question" onClick={() => set("questions", d.questions.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {d.questions.length < 5 && (
              <Button variant="outline" size="sm" onClick={() => set("questions", [...d.questions, { key: "", label: "", required: false }])}>
                <Plus className="h-4 w-4" /> Add a question
              </Button>
            )}
          </section>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.active} onCheckedChange={(v) => set("active", v)} />
            Visitors can book this
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !d.name.trim() || !d.slug}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {d.id ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
