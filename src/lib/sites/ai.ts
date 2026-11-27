import "server-only";
// AI landing page builder (Phase 2, workstream R). Platform admins describe a
// page in one prompt; the model returns blocks that exist, filled from the
// tenant's brand voice, knowledge base and business profile. Facts it can't
// support are left as visible "[Add …]" placeholders, which block publishing
// until someone replaces them. Runs on the platform's AI provider, not the
// tenant's, because the platform is doing the work.

import { z } from "zod";
import { AppError } from "@/lib/app-error";
import { logger, serializeError } from "@/lib/logger";
import { aiStructured, AiRefusalError, type AiMessage, type AiResult } from "@/lib/llm";
import { findBannedPhrases } from "@/lib/content/platforms";
import type { ContentContext } from "@/lib/content/generate";
import { CONVERSION_ANCHORS, FEATURE_ICONS, isSafeHref, type SiteBlock, type SiteBlockKey } from "./blocks";

export const LANDING_GOALS = ["leads", "bookings", "downloads"] as const;
export type LandingGoal = (typeof LANDING_GOALS)[number];

/** Which block converts for each goal. */
export const GOAL_BLOCK: Record<LandingGoal, "lead-form" | "booking" | "lead-magnet"> = {
  leads: "lead-form",
  bookings: "booking",
  downloads: "lead-magnet",
};

// ─── What the model may return ───────────────────────────────────────
// Every field is required (structured outputs in strict mode); "" means
// "leave it out". Ids for forms, magnets and booking types are never chosen
// by the model: the conversion block gets the ones the admin picked.

const str = z.string();
const CTA = {
  primaryCtaLabel: str,
  primaryCtaHref: str.describe("A link: the conversion anchor given in the instructions, a site path like /about, or empty."),
  secondaryCtaLabel: str,
  secondaryCtaHref: str,
};

export const AI_BLOCK_PROPS = {
  hero: z.object({
    eyebrow: str,
    title: str,
    subtitle: str,
    ...CTA,
    imageId: str.describe("The id of an image from the media list that fits, or empty."),
    align: z.enum(["center", "left"]),
  }),
  "feature-grid": z.object({
    eyebrow: str,
    title: str,
    subtitle: str,
    columns: z.number().int(),
    items: z.array(z.object({ icon: z.enum(FEATURE_ICONS), title: str, description: str })),
  }),
  testimonials: z.object({ title: str, items: z.array(z.object({ quote: str, author: str, role: str })) }),
  faq: z.object({ title: str, items: z.array(z.object({ question: str, answer: str })) }),
  cta: z.object({ title: str, subtitle: str, ...CTA }),
  "rich-text": z.object({ title: str, body: str.describe("Paragraphs separated by a blank line. **bold** is allowed.") }),
  stats: z.object({ title: str, items: z.array(z.object({ value: str, label: str })) }),
  "contact-details": z.object({ title: str, address: str, phone: str, email: str, whatsapp: str, hours: str }),
  gallery: z.object({ title: str, images: z.array(z.object({ imageId: str, alt: str, caption: str })) }),
  booking: z.object({ title: str, subtitle: str, buttonLabel: str }),
  "lead-form": z.object({ title: str, subtitle: str }),
  "lead-magnet": z.object({ title: str, subtitle: str }),
} satisfies Partial<Record<SiteBlockKey, z.ZodType>>;

export type AiBlockKey = keyof typeof AI_BLOCK_PROPS;
export const AI_BLOCK_KEYS = Object.keys(AI_BLOCK_PROPS) as AiBlockKey[];

const aiBlock = (k: AiBlockKey) => z.object({ blockKey: z.literal(k), props: AI_BLOCK_PROPS[k] });
const aiBlockUnion = z.union(AI_BLOCK_KEYS.map(aiBlock) as unknown as [ReturnType<typeof aiBlock>, ReturnType<typeof aiBlock>, ...ReturnType<typeof aiBlock>[]]);

export const pageOutputSchema = z.object({
  title: str.describe("The page title, under 60 characters."),
  slug: str.describe("A short URL path in lowercase-with-hyphens, e.g. roofing-quote."),
  seoTitle: str.describe("Under 60 characters."),
  seoDescription: str.describe("Under 155 characters."),
  blocks: z.array(aiBlockUnion).describe("5 to 9 blocks, in page order."),
});
export type PageOutput = z.infer<typeof pageOutputSchema>;
type AiBlock = PageOutput["blocks"][number];

// ─── Context ─────────────────────────────────────────────────────────

export interface PageInput {
  prompt: string;
  goal: LandingGoal;
  audience?: string | null;
  offer?: string | null;
}

export interface PageRefs {
  formId?: string | null;
  formName?: string | null;
  magnetId?: string | null;
  magnetTitle?: string | null;
  bookingTypeSlug?: string | null;
  bookingTypeName?: string | null;
}

export interface BuilderContext extends ContentContext {
  profile: { industry: string | null; email: string | null; phone: string | null; whatsapp: string | null };
  /** Images from the tenant's media library the model may use, by id. */
  images: { id: string; url: string; description: string }[];
}

const SECTION_GUIDE = `Blocks you can use (blockKey: purpose):
- hero: headline, supporting text and up to two buttons. Always first.
- feature-grid: 3 to 6 services or benefits with an icon each.
- testimonials: ONLY quotes that appear in the fact sheets. Otherwise one item whose quote is "[Add a real customer testimonial]" and author "[Add the customer's name]".
- faq: 3 to 6 questions visitors would ask, answered from the facts.
- cta: a closing banner with a button.
- rich-text: a short "about" or explanation section.
- stats: ONLY figures from the facts; otherwise skip this block.
- contact-details: the business's real contact details from the profile; leave unknown fields empty.
- gallery: only images from the media list.
- booking / lead-form / lead-magnet: the conversion section (see the goal).`;

export function buildPageSystemPrompt(ctx: BuilderContext): string {
  const facts = ctx.facts.length
    ? ctx.facts.map((f, i) => `### Fact sheet ${i + 1}: ${f.title}\n${f.content.slice(0, 2500)}`).join("\n\n")
    : "(No knowledge base articles matched this prompt.)";
  const profile = [
    `Business name: ${ctx.businessName || "(unknown)"}`,
    ctx.profile.industry && `Industry: ${ctx.profile.industry}`,
    ctx.profile.phone && `Phone: ${ctx.profile.phone}`,
    ctx.profile.whatsapp && `WhatsApp: ${ctx.profile.whatsapp}`,
    ctx.profile.email && `Email: ${ctx.profile.email}`,
  ]
    .filter(Boolean)
    .join("\n");
  const images = ctx.images.length ? ctx.images.map((i) => `- ${i.id}: ${i.description}`).join("\n") : "(none: leave imageId empty)";
  const never = ctx.dontPhrases.length ? ctx.dontPhrases.map((p) => `- ${p}`).join("\n") : "(none)";
  return `You build landing pages for ${ctx.businessName || "a business"} from a fixed set of blocks. You return the page as structured data.

${ctx.brandContext || "No brand voice profile has been set up: write in a clear, friendly, professional voice."}

RULES (follow strictly):
1. Only state facts about the business that appear in the business profile, the brand voice or the fact sheets. Never invent prices, discounts, years in business, numbers of customers, certifications, awards, guarantees, locations, staff names, customer names or testimonials.
2. Where a strong page would need a fact you don't have, write a visible placeholder in square brackets starting with "Add", e.g. "[Add your years in business]" or "[Add a real customer testimonial]". Someone replaces every placeholder before the page goes live, so use them instead of guessing. Never write a placeholder for something the facts already cover.
3. Never use any of these phrases:
${never}
4. Write in the language of the prompt unless it says otherwise. Plain text only: no HTML or markdown headings.
5. Empty string means "leave this out". Use it for any field you don't need.

${SECTION_GUIDE}

BUSINESS PROFILE:
${profile}

MEDIA LIST (images you may use, by id):
${images}

FACT SHEETS (from the knowledge base):
${facts}`;
}

export function buildPageUserMessage(input: PageInput, refs: PageRefs): string {
  const block = GOAL_BLOCK[input.goal];
  const anchor = CONVERSION_ANCHORS[block];
  const target =
    block === "lead-form"
      ? `a lead-form block (the form "${refs.formName ?? "contact form"}")`
      : block === "lead-magnet"
        ? `a lead-magnet block offering the free download "${refs.magnetTitle ?? "guide"}"`
        : `a booking block${refs.bookingTypeName ? ` for "${refs.bookingTypeName}"` : ""}`;
  const lines = [
    `<prompt>\n${input.prompt.trim()}\n</prompt>`,
    `Goal: ${input.goal}. The page must include exactly one ${target}, placed after the sections that build trust. Main buttons link to ${anchor}.`,
  ];
  if (input.audience?.trim()) lines.push(`Audience: ${input.audience.trim()}`);
  if (input.offer?.trim()) lines.push(`Offer to feature (the admin confirmed it is real): ${input.offer.trim()}`);
  lines.push("Return 5 to 9 blocks, starting with a hero.");
  return lines.join("\n\n");
}

// ─── Model output → blocks ───────────────────────────────────────────

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Keep only non-empty values, so optional block fields stay unset. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === "" || v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

const href = (v: unknown) => {
  const h = clip(v, 500);
  return h && isSafeHref(h) ? h : "";
};

/**
 * One model block as a page block, or null when it can't be used (no
 * content, or a conversion block of the wrong kind). Reference ids come
 * from `refs`, never from the model.
 */
export function toSiteBlock(b: AiBlock, refs: PageRefs, images: Map<string, string>, id = newId()): SiteBlock | null {
  const p = b.props as Record<string, unknown>;
  const cta = () => ({
    primaryCtaLabel: clip(p.primaryCtaLabel, 40),
    primaryCtaHref: href(p.primaryCtaHref),
    secondaryCtaLabel: clip(p.secondaryCtaLabel, 40),
    secondaryCtaHref: href(p.secondaryCtaHref),
  });
  const items = <T extends Record<string, unknown>>(v: unknown, max: number, map: (x: Record<string, unknown>) => T | null) =>
    (Array.isArray(v) ? v : [])
      .map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null))
      .filter((x): x is T => !!x)
      .slice(0, max);

  let props: Record<string, unknown>;
  switch (b.blockKey) {
    case "hero":
      props = { eyebrow: clip(p.eyebrow, 80), title: clip(p.title, 160), subtitle: clip(p.subtitle, 400), ...cta(), imageUrl: images.get(clip(p.imageId, 40)) ?? "", align: p.align === "left" ? "left" : "center" };
      if (!props.title) return null;
      break;
    case "feature-grid": {
      const list = items(p.items, 12, (x) => {
        const title = clip(x.title, 100);
        const description = clip(x.description, 500);
        return title && description ? { icon: FEATURE_ICONS.includes(x.icon as (typeof FEATURE_ICONS)[number]) ? x.icon : "check", title, description } : null;
      });
      if (!list.length) return null;
      const cols = Number(p.columns);
      props = { eyebrow: clip(p.eyebrow, 80), title: clip(p.title, 160), subtitle: clip(p.subtitle, 400), columns: cols >= 2 && cols <= 4 ? cols : Math.min(4, Math.max(2, list.length === 4 ? 2 : 3)), items: list };
      break;
    }
    case "testimonials": {
      const list = items(p.items, 12, (x) => {
        const quote = clip(x.quote, 800);
        const author = clip(x.author, 80);
        return quote && author ? compact({ quote, author, role: clip(x.role, 80) }) : null;
      });
      if (!list.length) return null;
      props = { title: clip(p.title, 160), items: list };
      break;
    }
    case "faq": {
      const list = items(p.items, 30, (x) => {
        const question = clip(x.question, 300);
        const answer = clip(x.answer, 2000);
        return question && answer ? { question, answer } : null;
      });
      if (!list.length) return null;
      props = { title: clip(p.title, 160), items: list };
      break;
    }
    case "cta":
      props = { title: clip(p.title, 160), subtitle: clip(p.subtitle, 400), ...cta() };
      if (!props.title) return null;
      break;
    case "rich-text":
      props = { title: clip(p.title, 160), body: clip(p.body, 10000) };
      if (!props.body) return null;
      break;
    case "stats": {
      const list = items(p.items, 8, (x) => {
        const value = clip(x.value, 30);
        const label = clip(x.label, 80);
        return value && label ? { value, label } : null;
      });
      if (!list.length) return null;
      props = { title: clip(p.title, 160), items: list };
      break;
    }
    case "contact-details": {
      const email = clip(p.email, 191);
      props = { title: clip(p.title, 160), address: clip(p.address, 400), phone: clip(p.phone, 40), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "", whatsapp: clip(p.whatsapp, 40), hours: clip(p.hours, 600) };
      if (!props.address && !props.phone && !props.email && !props.whatsapp && !props.hours) return null;
      break;
    }
    case "gallery": {
      const list = items(p.images, 24, (x) => {
        const url = images.get(clip(x.imageId, 40));
        return url ? compact({ url, alt: clip(x.alt, 200), caption: clip(x.caption, 200) }) : null;
      });
      if (!list.length) return null;
      props = { title: clip(p.title, 160), columns: 3, images: list };
      break;
    }
    case "booking":
      props = { title: clip(p.title, 160), subtitle: clip(p.subtitle, 400), buttonLabel: clip(p.buttonLabel, 40), bookingTypeSlug: refs.bookingTypeSlug ?? "" };
      break;
    case "lead-form":
      if (!refs.formId) return null;
      props = { title: clip(p.title, 160), subtitle: clip(p.subtitle, 400), formId: refs.formId };
      break;
    case "lead-magnet":
      if (!refs.magnetId) return null;
      props = { title: clip(p.title, 160), subtitle: clip(p.subtitle, 400), magnetId: refs.magnetId };
      break;
    default:
      return null;
  }
  return { id, blockKey: b.blockKey, props: compact(props) };
}

/** Default conversion block for a goal, used when the model left it out. */
function conversionBlock(goal: LandingGoal, refs: PageRefs): SiteBlock | null {
  const key = GOAL_BLOCK[goal];
  if (key === "lead-form") return refs.formId ? { id: newId(), blockKey: key, props: { title: "Get in touch", formId: refs.formId } } : null;
  if (key === "lead-magnet") return refs.magnetId ? { id: newId(), blockKey: key, props: { magnetId: refs.magnetId } } : null;
  return { id: newId(), blockKey: key, props: compact({ title: "Book a time", buttonLabel: "Book a time", bookingTypeSlug: refs.bookingTypeSlug ?? "" }) };
}

export interface BuiltPage {
  title: string;
  slug: string;
  seo: { title?: string; description?: string };
  blocks: SiteBlock[];
}

/** The model's page as stored blocks: exactly one conversion block for the goal, other conversion kinds dropped. */
export function toPage(out: PageOutput, input: PageInput, refs: PageRefs, imageList: BuilderContext["images"]): BuiltPage {
  const images = new Map(imageList.map((i) => [i.id, i.url]));
  const goalKey = GOAL_BLOCK[input.goal];
  const conversion = new Set(["booking", "lead-form", "lead-magnet"]);
  let seenGoal = false;
  const blocks: SiteBlock[] = [];
  for (const b of out.blocks.slice(0, 12)) {
    if (conversion.has(b.blockKey)) {
      if (b.blockKey !== goalKey || seenGoal) continue;
      seenGoal = true;
    }
    const block = toSiteBlock(b, refs, images);
    if (block) blocks.push(block);
    else if (b.blockKey === goalKey) seenGoal = false;
  }
  if (!blocks.some((b) => b.blockKey === goalKey)) {
    const add = conversionBlock(input.goal, refs);
    if (add) {
      // Before a closing CTA, if there is one.
      const at = blocks.length && blocks[blocks.length - 1].blockKey === "cta" ? blocks.length - 1 : blocks.length;
      blocks.splice(at, 0, add);
    }
  }
  if (blocks.length < 2) throw new AppError("The AI couldn't build a usable page from this prompt. Add more detail and try again.", { status: 502, code: "AI_EMPTY" });
  return {
    title: clip(out.title, 200) || "Landing page",
    slug: clip(out.slug, 80),
    seo: compact({ title: clip(out.seoTitle, 120), description: clip(out.seoDescription, 300) }),
    blocks,
  };
}

function pageText(blocks: SiteBlock[], extra: string[] = []) {
  const parts: string[] = [...extra];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  blocks.forEach((b) => walk(b.props));
  return parts.join("\n");
}

// ─── Calls ───────────────────────────────────────────────────────────

export interface AiSpend {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  model: string | null;
  provider: string | null;
}

async function call<S extends z.ZodType>(messages: AiMessage[], schema: S, spend: AiSpend): Promise<z.infer<S>> {
  try {
    // No businessId: the platform's provider and keys, not the tenant's.
    const res: AiResult & { data: z.infer<S> } = await aiStructured(messages, schema, { task: "plan", maxTokens: 12000 });
    spend.calls++;
    spend.promptTokens += res.promptTokens;
    spend.completionTokens += res.completionTokens;
    spend.model = res.model ?? spend.model;
    spend.provider = res.provider ?? spend.provider;
    return res.data;
  } catch (e) {
    logger.warn("Landing page generation failed", serializeError(e));
    if (e instanceof AiRefusalError) throw new AppError("The AI declined this request. Try rewording the prompt.", { status: 422, code: "AI_REFUSED" });
    throw new AppError("The AI couldn't build the page just now. Please try again.", { status: 502, code: "AI_FAILED" });
  }
}

export const newSpend = (): AiSpend => ({ calls: 0, promptTokens: 0, completionTokens: 0, model: null, provider: null });

export async function generatePage(ctx: BuilderContext, input: PageInput, refs: PageRefs, spend = newSpend()): Promise<BuiltPage> {
  const messages: AiMessage[] = [
    { role: "system", content: buildPageSystemPrompt(ctx) },
    { role: "user", content: buildPageUserMessage(input, refs) },
  ];
  const first = await call(messages, pageOutputSchema, spend);
  let page = toPage(first, input, refs, ctx.images);
  const banned = findBannedPhrases(pageText(page.blocks, [page.title]), ctx.dontPhrases);
  if (banned.length) {
    const retry = await call(
      [...messages, { role: "assistant", content: JSON.stringify(first) }, { role: "user", content: `Rewrite it without these phrases: ${banned.join(", ")}. Keep everything else.` }],
      pageOutputSchema,
      spend
    );
    page = toPage(retry, input, refs, ctx.images);
  }
  return page;
}

export const SECTION_ACTIONS = ["regenerate", "shorter", "persuasive", "custom"] as const;
export type SectionAction = (typeof SECTION_ACTIONS)[number];

const ACTION_TEXT: Record<SectionAction, string> = {
  regenerate: "Write this section again from scratch, with a fresh angle.",
  shorter: "Make it noticeably shorter (about half the words) while keeping its point.",
  persuasive: "Make it more persuasive: sharper benefits and a clearer reason to act. Still no invented facts.",
  custom: "",
};

/** Rewrite one block. Only that block and the page outline are sent; its id, kind and linked form/magnet/booking type stay the same. */
export async function rewriteSection(
  ctx: BuilderContext,
  block: SiteBlock,
  outline: { blockKey: string; title: string }[],
  action: SectionAction,
  instruction: string | null,
  spend = newSpend()
): Promise<SiteBlock> {
  const key = block.blockKey as AiBlockKey;
  if (!(key in AI_BLOCK_PROPS)) throw new AppError("The AI can't edit this kind of block. Edit it by hand.", { status: 400, code: "UNSUPPORTED_BLOCK" });
  const ask = action === "custom" ? `Apply this edit: ${instruction?.trim() || "improve it"}` : ACTION_TEXT[action];
  const messages: AiMessage[] = [
    { role: "system", content: buildPageSystemPrompt(ctx) },
    {
      role: "user",
      content: `Page outline (for context only, don't change other sections):\n${outline.map((o, i) => `${i + 1}. ${o.blockKey}${o.title ? `: ${o.title}` : ""}`).join("\n")}\n\nCurrent "${key}" section:\n${JSON.stringify(block.props)}\n\n${ask}\nReturn only this section's props.`,
    },
  ];
  const schema = z.object({ props: AI_BLOCK_PROPS[key] });
  const out = await call(messages, schema, spend);
  const refs: PageRefs = {
    formId: typeof block.props.formId === "string" ? block.props.formId : null,
    magnetId: typeof block.props.magnetId === "string" ? block.props.magnetId : null,
    bookingTypeSlug: typeof block.props.bookingTypeSlug === "string" ? block.props.bookingTypeSlug : null,
  };
  // Images already on the block stay usable (by url), plus the media list.
  const images = new Map(ctx.images.map((i) => [i.id, i.url]));
  const next = toSiteBlock({ blockKey: key, props: out.props } as AiBlock, refs, images, block.id);
  if (!next) throw new AppError("The AI returned an empty section. Try again or edit it by hand.", { status: 502, code: "AI_EMPTY" });
  if (key === "hero" && !next.props.imageUrl && typeof block.props.imageUrl === "string" && !String((out.props as { imageId?: string }).imageId ?? "")) {
    next.props.imageUrl = block.props.imageUrl;
  }
  const banned = findBannedPhrases(pageText([next]), ctx.dontPhrases);
  if (banned.length) throw new AppError(`The rewrite used a banned phrase (${banned.join(", ")}). Try again.`, { status: 502, code: "AI_BANNED_PHRASE" });
  return next;
}
