"use client";

// Renders a lead-capture form (Phase 2, workstream S) for visitors: on the
// hosted page /f/<id> and as the live preview in the builder. The embed on
// other websites (/forms.js) is a plain-JS copy of the same behaviour.

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { PublicForm } from "@/lib/forms/public";

type Props = {
  form: PublicForm;
  /** Preview in the builder: nothing is sent. */
  preview?: boolean;
  /** Values for hidden fields (e.g. from the page's query string). */
  hiddenValues?: Record<string, string>;
};

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--form-accent)] disabled:opacity-60";

export function LeadFormRenderer({ form, preview, hiddenValues }: Props) {
  const startedAt = useRef(Date.now());
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const accent = form.brandColor || "#1d4ed8";
  const visible = useMemo(() => form.fields.filter((f) => f.type !== "hidden"), [form.fields]);

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));
  const toggle = (key: string, option: string, on: boolean) => {
    const cur = (values[key] ?? "").split(", ").filter(Boolean);
    const next = on ? [...cur.filter((x) => x !== option), option] : cur.filter((x) => x !== option);
    set(key, form.fields.find((f) => f.key === key)?.options?.filter((o) => next.includes(o)).join(", ") ?? next.join(", "));
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (preview) return;
    setError(null);
    for (const f of visible) {
      if (f.required && !(values[f.key] ?? "").trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }
    if (form.consentText && !consent) {
      setError("Please tick the consent box to continue.");
      return;
    }
    const answers: Record<string, string> = {};
    for (const f of form.fields) answers[f.key] = f.type === "hidden" ? hiddenValues?.[f.key] ?? "" : values[f.key] ?? "";
    const website = (e.currentTarget.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
    setBusy(true);
    try {
      const r = await fetch(`/api/public/forms/${encodeURIComponent(form.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers, consent, website, startedAt: startedAt.current, pageUrl: location.origin + location.pathname }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
      if (form.redirectUrl) {
        window.location.assign(form.redirectUrl);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
        <CheckCircle2 className="h-10 w-10" style={{ color: accent }} aria-hidden />
        <p className="text-base">{form.successMessage}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" style={{ ["--form-accent" as string]: accent }}>
      {visible.map((f) => {
        const id = `ff-${form.id}-${f.key}`;
        const text = (
          <>
            {f.label}
            {f.required && <span className="text-destructive"> *</span>}
          </>
        );
        const labelCls = "mb-1.5 block text-sm font-medium";
        if (f.type === "radio" || f.type === "checkbox") {
          const chosen = (values[f.key] ?? "").split(", ");
          return (
            <fieldset key={f.key}>
              <legend className={labelCls}>{text}</legend>
              <div className="space-y-1.5">
                {(f.options ?? []).map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <input
                      type={f.type}
                      name={f.key}
                      value={o}
                      checked={f.type === "radio" ? values[f.key] === o : chosen.includes(o)}
                      onChange={(e) => (f.type === "radio" ? set(f.key, o) : toggle(f.key, o, e.target.checked))}
                      style={{ accentColor: accent }}
                    />
                    {o}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <div key={f.key}>
            <label htmlFor={id} className={labelCls}>
              {text}
            </label>
            {f.type === "textarea" ? (
              <textarea id={id} rows={4} maxLength={4000} placeholder={f.placeholder} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className={inputCls} />
            ) : f.type === "select" ? (
              <select id={id} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className={inputCls}>
                <option value="">{f.placeholder || "Choose…"}</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={f.type === "phone" ? "tel" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
                autoComplete={f.type === "email" ? "email" : f.type === "phone" ? "tel" : undefined}
                maxLength={500}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className={inputCls}
              />
            )}
          </div>
        );
      })}

      {/* Honeypot: hidden from people, filled in by bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {form.consentText && (
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" style={{ accentColor: accent }} />
          <span>{form.consentText}</span>
        </label>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || preview}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-70"
        style={{ background: accent }}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {form.submitLabel}
      </button>
    </form>
  );
}
