import { z } from "zod";

/**
 * Runtime schemas for CMS block props.
 *
 * The audit's final finding was that block props are spread through as
 * `Record<string, unknown>` (`as any` casts) into typed React components.
 * A typo in the CMS — say `tite` instead of `title`, or a missing required
 * `body` on the rich-text block — currently renders an empty `<h1></h1>`
 * with no error path. Editors don't notice and the page silently looks
 * wrong.
 *
 * Each entry below is a Zod schema that mirrors the corresponding block
 * component's TypeScript prop type. `validateBlockProps()` runs them and
 * returns either the validated props (typed against the schema) or a
 * validation error that the renderer can surface via `UnknownBlock`.
 *
 * The schemas are intentionally liberal (mostly `.optional()`) so a CMS
 * editor iterating on copy isn't fighting strict validation — but they
 * DO enforce:
 *   - `hero.title` must be a non-empty string
 *   - `rich-text.body` must be a non-empty string
 *   - `feature-grid.items` items must look like {icon?, title, description}
 *   - numeric / boolean fields are coerced where appropriate
 */

// ─── helpers ────────────────────────────────────────────────────────

const string_ = z.string();
const optionalString = z.string().optional();
const shortText = z.string().max(280).optional();

const ctaVariant = z.enum(["default", "gradient"]).optional();

// ─── per-block schemas ──────────────────────────────────────────────

export const heroPropsSchema = z.object({
  eyebrow: optionalString,
  title: string_.min(1, "hero.title is required"),
  subtitle: optionalString,
  primaryCtaLabel: optionalString,
  primaryCtaHref: optionalString,
  secondaryCtaLabel: optionalString,
  secondaryCtaHref: optionalString,
  highlight: optionalString,
});

const featureGridItemSchema = z.object({
  icon: optionalString,
  title: string_.min(1),
  description: z.string().min(1).max(500),
  href: optionalString,
});

export const featureGridPropsSchema = z.object({
  eyebrow: shortText,
  title: optionalString,
  subtitle: shortText,
  columns: z.coerce.number().int().min(1).max(6).optional(),
  items: z.array(featureGridItemSchema).max(24).optional(),
});

export const logoCloudPropsSchema = z.object({
  title: optionalString,
  logos: z.array(z.object({
    name: string_.min(1),
    logoText: optionalString,
    href: optionalString,
  })).max(50).optional(),
});

export const testimonialsPropsSchema = z.object({
  eyebrow: shortText,
  title: optionalString,
  testimonials: z.array(z.object({
    quote: z.string().min(1).max(1000),
    author: string_.min(1).max(80),
    role: optionalString,
    company: optionalString,
    avatarUrl: z.string().url().optional().or(z.literal("")),
  })).max(50).optional(),
});

export const pricingTablePropsSchema = z.object({
  eyebrow: shortText,
  title: optionalString,
  subtitle: shortText,
  ctaLabel: optionalString,
  ctaHref: optionalString,
  featuredPlanName: optionalString,
});

export const faqPropsSchema = z.object({
  eyebrow: shortText,
  title: optionalString,
  items: z.array(z.object({
    question: z.string().min(1).max(500),
    answer: z.string().min(1).max(2000),
  })).max(100).optional(),
});

export const ctaPropsSchema = z.object({
  title: optionalString,
  subtitle: shortText,
  primaryCtaLabel: optionalString,
  primaryCtaHref: optionalString,
  secondaryCtaLabel: optionalString,
  secondaryCtaHref: optionalString,
  variant: ctaVariant,
});

export const richTextPropsSchema = z.object({
  title: optionalString,
  body: string_.min(1, "rich-text.body is required"),
  align: z.enum(["left", "center"]).optional(),
});

export const statsPropsSchema = z.object({
  title: optionalString,
  stats: z.array(z.object({
    label: string_.min(1).max(80),
    value: string_.min(1).max(40),
    sublabel: optionalString,
  })).max(20).optional(),
  variant: z.enum(["default", "muted"]).optional(),
});

// ─── registry ───────────────────────────────────────────────────────

export type BlockKey =
  | "hero"
  | "feature-grid"
  | "logo-cloud"
  | "testimonials"
  | "pricing-table"
  | "faq"
  | "cta"
  | "rich-text"
  | "stats";

export const BLOCK_PROPS_SCHEMAS: Record<BlockKey, z.ZodTypeAny> = {
  hero: heroPropsSchema,
  "feature-grid": featureGridPropsSchema,
  "logo-cloud": logoCloudPropsSchema,
  testimonials: testimonialsPropsSchema,
  "pricing-table": pricingTablePropsSchema,
  faq: faqPropsSchema,
  cta: ctaPropsSchema,
  "rich-text": richTextPropsSchema,
  stats: statsPropsSchema,
};

export type ValidationResult<T> =
  | { ok: true; props: T }
  | { ok: false; issues: string[] };

/**
 * Validate the raw `props` blob for a given blockKey. Returns either the
 * parsed props (now strictly typed against the schema) or a list of
 * validation issues the renderer can show the editor.
 *
 * Unknown blockKeys are intentionally treated as "ok" — the renderer
 * falls back to `<UnknownBlock>` based on the key, not the props.
 */
export function validateBlockProps(
  blockKey: string,
  rawProps: unknown
): ValidationResult<unknown> {
  const schema = BLOCK_PROPS_SCHEMAS[blockKey as BlockKey];
  if (!schema) {
    // Unknown key — let the renderer's switch statement decide what to do.
    return { ok: true, props: rawProps };
  }
  const result = schema.safeParse(rawProps ?? {});
  if (result.success) return { ok: true, props: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`
    ),
  };
}
