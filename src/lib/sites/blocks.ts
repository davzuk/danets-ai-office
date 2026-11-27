// Website blocks: the only things a tenant page can contain. Pure (shared by
// the API, the public renderer and the editor). Each block has a Zod schema
// for its props and a list of editor fields the dashboard builds its form
// from. The keys match the platform CMS blocks (src/components/marketing)
// where they overlap, but the schemas are stricter: links must be safe,
// images are http(s) URLs (normally from the media library) and video is
// YouTube or Vimeo only. There is no HTML or script block.

import { z } from "zod";

// ─── Safe values ────────────────────────────────────────────────────

/** Links visitors can follow: site paths, anchors, http(s), mailto and tel. */
export function isSafeHref(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (v.startsWith("#")) return /^#[A-Za-z0-9_-]{0,80}$/.test(v);
  if (v.startsWith("/")) return !v.startsWith("//") && !/[\s\\]/.test(v);
  if (/^mailto:[^\s]+$/i.test(v) || /^tel:\+?[0-9 ()-]{3,30}$/i.test(v)) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function isImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type VideoEmbed = { provider: "youtube" | "vimeo"; id: string; embedUrl: string };

/** A YouTube or Vimeo page URL as a privacy-friendly embed URL, or null. */
export function parseVideoUrl(raw: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let yt: string | null = null;
  if (host === "youtu.be") yt = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") yt = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
      yt = m?.[1] ?? null;
    }
  }
  if (yt && /^[A-Za-z0-9_-]{11}$/.test(yt)) return { provider: "youtube", id: yt, embedUrl: `https://www.youtube-nocookie.com/embed/${yt}` };
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/);
    if (m) return { provider: "vimeo", id: m[1], embedUrl: `https://player.vimeo.com/video/${m[1]}?dnt=1` };
  }
  return null;
}

// ─── Schema helpers ─────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional();
const href = z.string().trim().max(500).refine(isSafeHref, "Use a page path (/about), an https:// link, mailto: or tel:");
const optHref = z.union([href, z.literal("")]).optional();
const imageUrl = z.string().trim().max(1000).refine(isImageUrl, "Choose an image");
const optImage = z.union([imageUrl, z.literal("")]).optional();
const recordId = (what: string) => z.string({ error: `Choose ${what}` }).trim().regex(/^[a-z0-9]{10,40}$/i, `Choose ${what}`);

export const FEATURE_ICONS = [
  "sparkles", "check", "star", "shield", "clock", "zap", "heart", "users", "phone", "map-pin",
  "wrench", "truck", "leaf", "award", "smile", "thumbs-up", "home", "briefcase", "calendar", "message",
] as const;

// ─── Blocks ─────────────────────────────────────────────────────────

export const SITE_BLOCK_SCHEMAS = {
  hero: z.object({
    eyebrow: optText(80),
    title: text(160).min(1, "Add a headline"),
    subtitle: optText(400),
    primaryCtaLabel: optText(40),
    primaryCtaHref: optHref,
    secondaryCtaLabel: optText(40),
    secondaryCtaHref: optHref,
    imageUrl: optImage,
    align: z.enum(["center", "left"]).optional(),
  }),
  "feature-grid": z.object({
    eyebrow: optText(80),
    title: optText(160),
    subtitle: optText(400),
    columns: z.coerce.number().int().min(2).max(4).optional(),
    items: z
      .array(z.object({ icon: z.enum(FEATURE_ICONS).optional(), title: text(100).min(1, "Add a title"), description: text(500).min(1, "Add a description") }))
      .min(1, "Add at least one item")
      .max(12),
  }),
  testimonials: z.object({
    title: optText(160),
    items: z
      .array(z.object({ quote: text(800).min(1, "Add the quote"), author: text(80).min(1, "Add who said it"), role: optText(80) }))
      .min(1, "Add at least one testimonial")
      .max(12),
  }),
  faq: z.object({
    title: optText(160),
    items: z
      .array(z.object({ question: text(300).min(1, "Add the question"), answer: text(2000).min(1, "Add the answer") }))
      .min(1, "Add at least one question")
      .max(30),
  }),
  cta: z.object({
    title: text(160).min(1, "Add a headline"),
    subtitle: optText(400),
    primaryCtaLabel: optText(40),
    primaryCtaHref: optHref,
    secondaryCtaLabel: optText(40),
    secondaryCtaHref: optHref,
  }),
  "rich-text": z.object({
    title: optText(160),
    body: text(10000).min(1, "Add some text"),
    align: z.enum(["left", "center"]).optional(),
  }),
  stats: z.object({
    title: optText(160),
    items: z
      .array(z.object({ value: text(30).min(1, "Add the number"), label: text(80).min(1, "Add a label") }))
      .min(1, "Add at least one figure")
      .max(8),
  }),
  "logo-cloud": z.object({
    title: optText(160),
    logos: z
      .array(z.object({ name: text(80).min(1, "Add the name"), imageUrl: optImage, href: optHref }))
      .min(1, "Add at least one logo")
      .max(24),
  }),
  "contact-details": z.object({
    title: optText(160),
    address: optText(400),
    phone: optText(40),
    email: z.union([z.string().trim().email("Enter a valid email").max(191), z.literal("")]).optional(),
    whatsapp: optText(40),
    hours: optText(600),
    mapUrl: optHref,
  }),
  gallery: z.object({
    title: optText(160),
    columns: z.coerce.number().int().min(2).max(4).optional(),
    images: z
      .array(z.object({ url: imageUrl, alt: optText(200), caption: optText(200) }))
      .min(1, "Add at least one image")
      .max(24),
  }),
  video: z.object({
    title: optText(160),
    url: z.string().trim().max(500).refine((v) => !!parseVideoUrl(v), "Paste a YouTube or Vimeo link"),
    caption: optText(300),
  }),
  booking: z.object({
    title: optText(160),
    subtitle: optText(400),
    bookingTypeSlug: optText(80),
    buttonLabel: optText(40),
  }),
  "lead-form": z.object({
    title: optText(160),
    subtitle: optText(400),
    formId: recordId("a form"),
  }),
  "lead-magnet": z.object({
    title: optText(160),
    subtitle: optText(400),
    magnetId: recordId("a lead magnet"),
  }),
} as const;

export type SiteBlockKey = keyof typeof SITE_BLOCK_SCHEMAS;
export const SITE_BLOCK_KEYS = Object.keys(SITE_BLOCK_SCHEMAS) as SiteBlockKey[];
export type SiteBlockProps<K extends SiteBlockKey> = z.infer<(typeof SITE_BLOCK_SCHEMAS)[K]>;

export interface SiteBlock {
  /** Stable per page, for reordering and React keys. */
  id: string;
  blockKey: SiteBlockKey;
  props: Record<string, unknown>;
}

// ─── Editor fields ──────────────────────────────────────────────────

export type BlockField =
  | { name: string; label: string; type: "text" | "textarea" | "href" | "image" | "video" | "email"; placeholder?: string; help?: string; required?: boolean }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { name: string; label: string; type: "booking-type" }
  | { name: string; label: string; type: "form" | "lead-magnet" }
  | { name: string; label: string; type: "list"; itemLabel: string; max: number; fields: BlockField[] };

const ctaFields: BlockField[] = [
  { name: "primaryCtaLabel", label: "Main button text", type: "text", placeholder: "Get a quote" },
  { name: "primaryCtaHref", label: "Main button link", type: "href", placeholder: "/contact or https://…" },
  { name: "secondaryCtaLabel", label: "Second button text", type: "text" },
  { name: "secondaryCtaHref", label: "Second button link", type: "href" },
];
const columns: BlockField = { name: "columns", label: "Columns", type: "select", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] };

export const SITE_BLOCK_DEFS: Record<SiteBlockKey, { label: string; description: string; fields: BlockField[]; defaults: Record<string, unknown> }> = {
  hero: {
    label: "Hero",
    description: "Big headline at the top of a page, with buttons and an image.",
    fields: [
      { name: "eyebrow", label: "Small text above the headline", type: "text" },
      { name: "title", label: "Headline", type: "text", required: true },
      { name: "subtitle", label: "Supporting text", type: "textarea" },
      ...ctaFields,
      { name: "imageUrl", label: "Image", type: "image" },
      { name: "align", label: "Alignment", type: "select", options: [{ value: "center", label: "Centred" }, { value: "left", label: "Left, image on the right" }] },
    ],
    defaults: { title: "Your headline here", subtitle: "One or two sentences on what you do and who it's for.", primaryCtaLabel: "Get in touch", primaryCtaHref: "#contact", align: "center" },
  },
  "feature-grid": {
    label: "Features or services",
    description: "A grid of short items with icons.",
    fields: [
      { name: "eyebrow", label: "Small text above the title", type: "text" },
      { name: "title", label: "Title", type: "text" },
      { name: "subtitle", label: "Supporting text", type: "textarea" },
      columns,
      {
        name: "items",
        label: "Items",
        type: "list",
        itemLabel: "Item",
        max: 12,
        fields: [
          { name: "icon", label: "Icon", type: "select", options: FEATURE_ICONS.map((i) => ({ value: i, label: i.replace("-", " ") })) },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "description", label: "Description", type: "textarea", required: true },
        ],
      },
    ],
    defaults: { title: "What we do", columns: 3, items: [{ icon: "check", title: "First service", description: "A sentence about it." }, { icon: "star", title: "Second service", description: "A sentence about it." }, { icon: "shield", title: "Third service", description: "A sentence about it." }] },
  },
  testimonials: {
    label: "Testimonials",
    description: "Quotes from real customers.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "items", label: "Testimonials", type: "list", itemLabel: "Testimonial", max: 12, fields: [
        { name: "quote", label: "Quote", type: "textarea", required: true },
        { name: "author", label: "Name", type: "text", required: true },
        { name: "role", label: "Role or location", type: "text" },
      ] },
    ],
    defaults: { title: "What customers say", items: [{ quote: "Add a real quote from a customer.", author: "Customer name" }] },
  },
  faq: {
    label: "FAQ",
    description: "Questions and answers.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "items", label: "Questions", type: "list", itemLabel: "Question", max: 30, fields: [
        { name: "question", label: "Question", type: "text", required: true },
        { name: "answer", label: "Answer", type: "textarea", required: true },
      ] },
    ],
    defaults: { title: "Frequently asked questions", items: [{ question: "A question customers ask?", answer: "Your answer." }] },
  },
  cta: {
    label: "Call to action",
    description: "A banner asking visitors to act.",
    fields: [{ name: "title", label: "Headline", type: "text", required: true }, { name: "subtitle", label: "Supporting text", type: "textarea" }, ...ctaFields],
    defaults: { title: "Ready to get started?", primaryCtaLabel: "Contact us", primaryCtaHref: "#contact" },
  },
  "rich-text": {
    label: "Text",
    description: "Paragraphs. **bold** and [links](https://…) work.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "body", label: "Text", type: "textarea", required: true, help: "Leave a blank line between paragraphs. Use **bold** and [link text](https://…)." },
      { name: "align", label: "Alignment", type: "select", options: [{ value: "left", label: "Left" }, { value: "center", label: "Centred" }] },
    ],
    defaults: { title: "About us", body: "Tell visitors who you are and why they should choose you." },
  },
  stats: {
    label: "Numbers",
    description: "A row of key figures.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "items", label: "Figures", type: "list", itemLabel: "Figure", max: 8, fields: [
        { name: "value", label: "Number", type: "text", required: true, placeholder: "500+" },
        { name: "label", label: "Label", type: "text", required: true, placeholder: "Happy customers" },
      ] },
    ],
    defaults: { items: [{ value: "10+", label: "Years in business" }, { value: "500+", label: "Customers" }] },
  },
  "logo-cloud": {
    label: "Logos",
    description: "Clients, partners or accreditations.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "logos", label: "Logos", type: "list", itemLabel: "Logo", max: 24, fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "imageUrl", label: "Logo image", type: "image" },
        { name: "href", label: "Link", type: "href" },
      ] },
    ],
    defaults: { title: "Trusted by", logos: [{ name: "Partner name" }] },
  },
  "contact-details": {
    label: "Contact details",
    description: "Address, phone, email, WhatsApp and opening hours.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "address", label: "Address", type: "textarea" },
      { name: "phone", label: "Phone", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "whatsapp", label: "WhatsApp number", type: "text", placeholder: "+234 803 000 0000" },
      { name: "hours", label: "Opening hours", type: "textarea", placeholder: "Mon–Fri 9am–5pm" },
      { name: "mapUrl", label: "Map link", type: "href", placeholder: "https://maps.google.com/…" },
    ],
    defaults: { title: "Contact us" },
  },
  gallery: {
    label: "Gallery",
    description: "A grid of photos from your media library.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      columns,
      { name: "images", label: "Images", type: "list", itemLabel: "Image", max: 24, fields: [
        { name: "url", label: "Image", type: "image", required: true },
        { name: "alt", label: "Description (for screen readers)", type: "text" },
        { name: "caption", label: "Caption", type: "text" },
      ] },
    ],
    defaults: { title: "Our work", columns: 3, images: [] },
  },
  video: {
    label: "Video",
    description: "A YouTube or Vimeo video.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "url", label: "YouTube or Vimeo link", type: "video", required: true },
      { name: "caption", label: "Caption", type: "text" },
    ],
    defaults: { url: "" },
  },
  booking: {
    label: "Booking",
    description: "A button that opens your booking page.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "subtitle", label: "Supporting text", type: "textarea" },
      { name: "bookingTypeSlug", label: "Booking type", type: "booking-type" },
      { name: "buttonLabel", label: "Button text", type: "text", placeholder: "Book a time" },
    ],
    defaults: { title: "Book a time", subtitle: "Pick a time that suits you.", buttonLabel: "Book a time" },
  },
  "lead-form": {
    label: "Lead form",
    description: "One of the tenant's forms. Submissions become leads.",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "subtitle", label: "Supporting text", type: "textarea" },
      { name: "formId", label: "Form", type: "form" },
    ],
    defaults: { title: "Get in touch", subtitle: "Tell us what you need and we'll get back to you." },
  },
  "lead-magnet": {
    label: "Lead magnet",
    description: "A free download offered for an email address.",
    fields: [
      { name: "title", label: "Section title (optional)", type: "text" },
      { name: "subtitle", label: "Supporting text", type: "textarea" },
      { name: "magnetId", label: "Lead magnet", type: "lead-magnet" },
    ],
    defaults: {},
  },
};

/** The section anchor each conversion block renders with, for button links. */
export const CONVERSION_ANCHORS = { booking: "#book", "lead-form": "#form", "lead-magnet": "#download" } as const;

// ─── Placeholders ───────────────────────────────────────────────────

/**
 * Text the AI page builder leaves where it lacks a real fact, e.g.
 * "[Add a real testimonial]". A page can't be published while any remain.
 */
export const PLACEHOLDER_RE = /\[(?:add|insert|replace|confirm)\b[^\]]{0,200}\]/gi;

export type Placeholder = { blockId: string; blockKey: SiteBlockKey; index: number; path: string; text: string };

export function findPlaceholders(blocks: SiteBlock[]): Placeholder[] {
  const out: Placeholder[] = [];
  const walk = (v: unknown, path: string, b: SiteBlock, index: number) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(PLACEHOLDER_RE)) out.push({ blockId: b.id, blockKey: b.blockKey, index, path, text: m[0] });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i), b, index));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, b, index);
  };
  blocks.forEach((b, i) => walk(b.props, "", b, i));
  return out;
}

// ─── Page validation ────────────────────────────────────────────────

export const MAX_BLOCKS = 40;

/** Structure only (drafts may be half-filled): ids, known keys, object props. */
export const pageBlocksSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
      blockKey: z.enum(SITE_BLOCK_KEYS as [SiteBlockKey, ...SiteBlockKey[]]),
      props: z.record(z.string(), z.unknown()),
    })
  )
  .max(MAX_BLOCKS, `A page can have up to ${MAX_BLOCKS} blocks.`)
  .refine((list) => new Set(list.map((b) => b.id)).size === list.length, "Block ids must be unique.")
  .refine((list) => JSON.stringify(list).length <= 200_000, "This page is too large.");

export type BlockIssue = { blockId: string; blockKey: SiteBlockKey; index: number; messages: string[] };

export type ParsedBlock = { id: string; blockKey: SiteBlockKey; props: Record<string, unknown> };

/** Check every block's props. Publishing needs no issues; the renderer skips invalid blocks. */
export function validateBlocks(blocks: SiteBlock[]): { blocks: ParsedBlock[]; issues: BlockIssue[] } {
  const out: ParsedBlock[] = [];
  const issues: BlockIssue[] = [];
  blocks.forEach((b, index) => {
    const schema = SITE_BLOCK_SCHEMAS[b.blockKey];
    const r = schema ? schema.safeParse(b.props ?? {}) : null;
    if (r?.success) out.push({ id: b.id, blockKey: b.blockKey, props: r.data as Record<string, unknown> });
    else
      issues.push({
        blockId: b.id,
        blockKey: b.blockKey,
        index,
        messages: r ? r.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)) : ["Unknown block"],
      });
  });
  return { blocks: out, issues };
}

/** Read stored blocks defensively (bad rows render nothing rather than crash). */
export function readBlocks(raw: unknown): SiteBlock[] {
  const r = pageBlocksSchema.safeParse(raw);
  return r.success ? (r.data as SiteBlock[]) : [];
}

// ─── Page SEO and site theme ────────────────────────────────────────

export const pageSeoSchema = z.object({
  title: optText(120),
  description: optText(300),
  ogImageUrl: optImage,
  noindex: z.boolean().optional(),
  hideFromNav: z.boolean().optional(),
});
export type PageSeo = z.infer<typeof pageSeoSchema>;

export const SITE_FONTS = {
  system: { label: "Modern sans", stack: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" },
  serif: { label: "Classic serif", stack: "Georgia, Cambria, 'Times New Roman', Times, serif" },
  rounded: { label: "Friendly rounded", stack: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Segoe UI', system-ui, sans-serif" },
  mono: { label: "Technical mono", stack: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" },
} as const;

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1d4ed8");

export const siteThemeSchema = z.object({
  primaryColor: hex.optional(),
  accentColor: hex.optional(),
  font: z.enum(Object.keys(SITE_FONTS) as [keyof typeof SITE_FONTS, ...(keyof typeof SITE_FONTS)[]]).optional(),
  logoUrl: optImage,
});
export type SiteTheme = z.infer<typeof siteThemeSchema>;

export const siteSeoDefaultsSchema = z.object({
  titleSuffix: optText(80),
  description: optText(300),
  ogImageUrl: optImage,
});
export type SiteSeoDefaults = z.infer<typeof siteSeoDefaultsSchema>;

export const DEFAULT_THEME: Required<Pick<SiteTheme, "primaryColor" | "accentColor" | "font">> = {
  primaryColor: "#1d4ed8",
  accentColor: "#f59e0b",
  font: "system",
};

/** Black or white text, whichever reads better on a colour (WCAG relative luminance). */
export function readableOn(hexColor: string): "#ffffff" | "#111827" {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hexColor);
  if (!m) return "#ffffff";
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16));
  // Contrast with white is (1.05)/(L+0.05); with near-black ~ (L+0.05)/(0.0185+0.05).
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0685 ? "#ffffff" : "#111827";
}

/** A new block with its starting content. */
export function newBlock(blockKey: SiteBlockKey, id: string): SiteBlock {
  return { id, blockKey, props: structuredClone(SITE_BLOCK_DEFS[blockKey].defaults) };
}
