import { z } from "zod";

export const FORM_FIELD_TYPES = ["text", "email", "phone", "textarea", "select", "radio", "checkbox", "date", "hidden"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_MAP_TARGETS = ["name", "email", "phone", "company", "service", "message"] as const;
export type FormMapTarget = (typeof FORM_MAP_TARGETS)[number];

export interface FormField {
  key: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
  mapTo?: FormMapTarget;
}

const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;

/** Why a single field is unusable, or null when it's fine. Pure. */
export function fieldProblem(f: unknown): string | null {
  if (!f || typeof f !== "object") return "Invalid field.";
  const o = f as Record<string, unknown>;
  if (typeof o.key !== "string" || !KEY_RE.test(o.key)) return "Each field needs a short key of lower-case letters, numbers or underscores.";
  const type = o.type as string;
  if (!FORM_FIELD_TYPES.includes(type as FormFieldType)) return "Unknown field type.";
  if (typeof o.label !== "string" || !o.label.trim()) return "Give each field a label.";
  if ((type === "select" || type === "radio" || type === "checkbox") && (!Array.isArray(o.options) || o.options.length === 0)) return `${type} needs options.`;
  return null;
}

/** Normalise a fields array into clean FormFields, collecting problems. */
export function normalizeFields(raw: unknown): { fields: FormField[]; problems: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const problems: string[] = [];
  const fields: FormField[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    const problem = fieldProblem(f);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const o = f as FormField;
    if (seen.has(o.key)) {
      problems.push(`Duplicate field key "${o.key}".`);
      continue;
    }
    seen.add(o.key);
    fields.push({
      key: o.key,
      type: o.type,
      label: o.label.trim(),
      required: !!o.required,
      placeholder: typeof o.placeholder === "string" ? o.placeholder.slice(0, 120) : undefined,
      options: Array.isArray(o.options) ? o.options.map((x) => String(x).slice(0, 200)).slice(0, 50) : undefined,
      mapTo: o.mapTo && FORM_MAP_TARGETS.includes(o.mapTo as FormMapTarget) ? (o.mapTo as FormMapTarget) : undefined,
    });
  }
  return { fields, problems };
}

function fieldZod(f: FormField): z.ZodTypeAny {
  if (f.type === "checkbox") {
    const base = z.union([z.boolean(), z.string().max(500)]);
    return f.required ? z.union([z.boolean(), z.string().min(1).max(500)]) : base.optional().or(z.literal(""));
  }
  if (f.type === "email") {
    const base = z.string().trim().email("Enter a valid email address");
    return f.required ? base.min(1, "Required") : base.optional().or(z.literal(""));
  }
  const max = f.type === "textarea" ? 4000 : 500;
  const base = z.string().trim().max(max);
  return f.required ? base.min(1, "Required") : base.optional().or(z.literal(""));
}

/** Build a zod schema that validates a visitor's answers for these fields. */
export function buildFormSchema(fields: FormField[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) shape[f.key] = fieldZod(f);
  return z.object(shape);
}

/** Map answers onto the Lead profile using each field's `mapTo`. */
export function mapProfile(fields: FormField[], answers: Record<string, unknown>): {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  service?: string;
  message?: string;
} {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!f.mapTo) continue;
    const v = answers[f.key];
    if (typeof v === "string" && v.trim()) out[f.mapTo] = v.trim();
  }
  return out;
}