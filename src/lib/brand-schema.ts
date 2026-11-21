import { z } from "zod";

/**
 * Brand Voice profile: shape, limits and the prompt block built from it.
 * Pure and client-safe (no DB / AI imports): the settings UI shares the
 * limits, and unit tests cover buildBrandContext without MySQL.
 */

export const BRAND_LIMITS = {
  summary: 1200,
  item: 200, // one phrase / value prop / pain / desire
  audience: 6,
  perSegment: 6,
  adjectives: 6,
  valueProps: 8,
  offers: 8,
  phrases: 15,
  locales: 5,
} as const;

const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLen: number = BRAND_LIMITS.item) => z.array(text(maxLen).min(1)).max(maxItems);

export const audienceSegmentSchema = z.object({
  segment: text(120).min(1),
  pains: list(BRAND_LIMITS.perSegment),
  desires: list(BRAND_LIMITS.perSegment),
});

export const brandToneSchema = z.object({
  adjectives: list(BRAND_LIMITS.adjectives, 40),
  formality: z.number().int().min(1).max(5), // 1 = very casual, 5 = very formal
  emoji: z.boolean(),
});

export const brandOfferSchema = z.object({
  name: text(120).min(1),
  price: text(60).nullable(),
  cta: text(120).min(1),
  url: z.string().trim().url().max(500).nullable(),
});

/** What an admin can save (PUT /api/brand-profile). */
export const brandProfileInputSchema = z.object({
  summary: text(BRAND_LIMITS.summary).nullable(),
  audience: z.array(audienceSegmentSchema).max(BRAND_LIMITS.audience),
  tone: brandToneSchema,
  valueProps: list(BRAND_LIMITS.valueProps),
  offers: z.array(brandOfferSchema).max(BRAND_LIMITS.offers),
  doPhrases: list(BRAND_LIMITS.phrases),
  dontPhrases: list(BRAND_LIMITS.phrases),
  locales: list(BRAND_LIMITS.locales, 20),
  websiteUrl: z.string().trim().url().max(500).nullable(),
});
export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;

export const EMPTY_BRAND_PROFILE: BrandProfileInput = {
  summary: null,
  audience: [],
  tone: { adjectives: [], formality: 3, emoji: false },
  valueProps: [],
  offers: [],
  doPhrases: [],
  dontPhrases: [],
  locales: [],
  websiteUrl: null,
};

/**
 * Schema the model fills in when generating. No length limits (structured
 * outputs ignores them and a long answer shouldn't fail the whole run);
 * normalizeBrandProfile() clamps the result into BrandProfileInput.
 */
export const generatedBrandSchema = z.object({
  summary: z.string().describe("One paragraph, under 120 words: who the business is, what it sells, who for."),
  audience: z
    .array(z.object({ segment: z.string(), pains: z.array(z.string()), desires: z.array(z.string()) }))
    .describe("2-4 customer segments, each with 2-4 pains and desires."),
  tone: z.object({
    adjectives: z.array(z.string()).describe("3-5 single-word voice adjectives."),
    formality: z.number().describe("1 = very casual, 5 = very formal."),
    emoji: z.boolean().describe("Whether emoji suit this brand's social posts."),
  }),
  valueProps: z.array(z.string()).describe("3-6 short reasons to choose this business, grounded in the source material."),
  offers: z
    .array(z.object({ name: z.string(), price: z.string().nullable(), cta: z.string(), url: z.string().nullable() }))
    .describe("Products/services with a call to action. Price and url only if stated in the source; else null."),
  doPhrases: z.array(z.string()).describe("Phrases and terms the brand uses."),
  dontPhrases: z.array(z.string()).describe("Phrases, claims or styles to avoid."),
  locales: z.array(z.string()).describe("BCP 47 language tags the audience uses, e.g. en-NG."),
});
export type GeneratedBrand = z.infer<typeof generatedBrandSchema>;

function clampList(xs: unknown, maxItems: number, maxLen: number = BRAND_LIMITS.item): string[] {
  if (!Array.isArray(xs)) return [];
  const out: string[] = [];
  for (const x of xs) {
    if (typeof x !== "string") continue;
    const t = x.trim().slice(0, maxLen);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function urlOrNull(u: unknown): string | null {
  if (typeof u !== "string" || !u.trim()) return null;
  const parsed = z.string().url().max(500).safeParse(u.trim());
  return parsed.success && /^https?:/i.test(parsed.data) ? parsed.data : null;
}

/** Coerce stored JSON or model output into a valid BrandProfileInput. Never throws. */
export function normalizeBrandProfile(raw: Partial<Record<keyof BrandProfileInput, unknown>> | null | undefined): BrandProfileInput {
  if (!raw) return structuredClone(EMPTY_BRAND_PROFILE);
  const tone = (raw.tone ?? {}) as Record<string, unknown>;
  const formality = Math.round(Number(tone.formality));
  return {
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, BRAND_LIMITS.summary) : null,
    audience: (Array.isArray(raw.audience) ? raw.audience : [])
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { segment?: unknown }).segment === "string")
      .map((a) => ({
        segment: String(a.segment).trim().slice(0, 120),
        pains: clampList(a.pains, BRAND_LIMITS.perSegment),
        desires: clampList(a.desires, BRAND_LIMITS.perSegment),
      }))
      .filter((a) => a.segment)
      .slice(0, BRAND_LIMITS.audience),
    tone: {
      adjectives: clampList(tone.adjectives, BRAND_LIMITS.adjectives, 40),
      formality: Number.isFinite(formality) ? Math.min(5, Math.max(1, formality)) : 3,
      emoji: tone.emoji === true,
    },
    valueProps: clampList(raw.valueProps, BRAND_LIMITS.valueProps),
    offers: (Array.isArray(raw.offers) ? raw.offers : [])
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({
        name: typeof o.name === "string" ? o.name.trim().slice(0, 120) : "",
        price: typeof o.price === "string" && o.price.trim() ? o.price.trim().slice(0, 60) : null,
        cta: typeof o.cta === "string" ? o.cta.trim().slice(0, 120) : "",
        url: urlOrNull(o.url),
      }))
      .filter((o) => o.name && o.cta)
      .slice(0, BRAND_LIMITS.offers),
    doPhrases: clampList(raw.doPhrases, BRAND_LIMITS.phrases),
    dontPhrases: clampList(raw.dontPhrases, BRAND_LIMITS.phrases),
    locales: clampList(raw.locales, BRAND_LIMITS.locales, 20),
    websiteUrl: urlOrNull(raw.websiteUrl),
  };
}

const FORMALITY = ["", "very casual", "casual", "conversational", "professional", "formal"];

/**
 * Deterministic system-prompt block describing the brand. Same profile in →
 * byte-identical text out (no timestamps, no ids, stable field order), so it
 * can sit in a cached system prompt prefix. Returns "" when nothing is set.
 */
export function buildBrandContext(businessName: string, profile: BrandProfileInput | null): string {
  if (!profile) return "";
  const p = normalizeBrandProfile(profile);
  const lines: string[] = [];
  const section = (title: string, body: string[]) => {
    if (body.length) lines.push(`## ${title}`, ...body, "");
  };
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`);

  section("About", p.summary ? [p.summary] : []);
  section("Voice", [
    ...(p.tone.adjectives.length ? [`- Sound: ${p.tone.adjectives.join(", ")}`] : []),
    `- Formality: ${p.tone.formality}/5 (${FORMALITY[p.tone.formality]})`,
    `- Emoji: ${p.tone.emoji ? "allowed, sparingly" : "do not use"}`,
  ]);
  section(
    "Audience",
    p.audience.map((a) => {
      const parts = [a.segment];
      if (a.pains.length) parts.push(`pains: ${a.pains.join("; ")}`);
      if (a.desires.length) parts.push(`wants: ${a.desires.join("; ")}`);
      return `- ${parts.join(" | ")}`;
    })
  );
  section("Why customers choose us", bullets(p.valueProps));
  section(
    "Offers",
    p.offers.map((o) => `- ${o.name}${o.price ? ` (${o.price})` : ""}: ${o.cta}${o.url ? ` <${o.url}>` : ""}`)
  );
  section("Say", bullets(p.doPhrases));
  section("Never say", bullets(p.dontPhrases));
  section("Languages", p.locales.length ? [p.locales.join(", ")] : []);
  section("Website", p.websiteUrl ? [p.websiteUrl] : []);

  const hasContent = p.summary || p.audience.length || p.valueProps.length || p.offers.length || p.doPhrases.length || p.dontPhrases.length || p.tone.adjectives.length;
  if (!hasContent) return "";
  return [`# Brand voice: ${businessName.trim()}`, "Write as this brand. Stay within these facts; don't invent prices, offers or claims.", "", ...lines]
    .join("\n")
    .trimEnd();
}
