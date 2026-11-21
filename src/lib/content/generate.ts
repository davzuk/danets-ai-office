// AI Content Studio generation: one brief → one variant per platform, in the
// brand voice, grounded in the brand profile and knowledge base.
//
// Flow: generate → check every variant against its platform's rules and the
// brand's banned phrases → re-ask once for the ones that fail → enforce the
// hard limits mechanically if the model still missed (so nothing over the
// limit or containing a banned phrase is ever returned).

import { z } from "zod";
import { AppError } from "@/lib/app-error";
import { logger, serializeError } from "@/lib/logger";
import { aiStructured, logUsage, AiRefusalError, type AiMessage, type AiResult } from "@/lib/llm";
import {
  CONTENT_PLATFORMS,
  PLATFORM_RULES,
  checkVariant,
  composeText,
  findBannedPhrases,
  hasErrors,
  normalizeHashtags,
  platformLength,
  scrubBannedPhrases,
  type ContentGoal,
  type ContentPlatform,
  type VariantContent,
  type VariantIssue,
} from "./platforms";

export const CONTENT_USAGE_FEATURE = "content_generate";

export const CONTENT_LIMITS = {
  brief: 4000,
  toneTweak: 200,
  instruction: 500,
} as const;

/** What the model knows about the business. Loaded once per request (see loadContentContext). */
export interface ContentContext {
  businessName: string;
  brandContext: string;
  dontPhrases: string[];
  facts: { title: string; content: string }[];
}

export interface GeneratedVariant extends VariantContent {
  platform: ContentPlatform;
  imagePrompt: string | null;
  issues: VariantIssue[];
}

export interface GenerationResult {
  variants: GeneratedVariant[];
  aiCalls: number;
}

const modelVariantSchema = z.object({
  platform: z.enum(CONTENT_PLATFORMS),
  body: z.string().describe("The post text, without hashtags (they go in the hashtags field)."),
  hashtags: z.array(z.string()).describe("Hashtags without the # sign."),
  imagePrompt: z.string().describe("One or two sentences describing the image or video to pair with the post."),
});
const modelOutputSchema = z.object({ variants: z.array(modelVariantSchema) });
type ModelOutput = z.infer<typeof modelOutputSchema>;

const GOAL_GUIDANCE: Record<ContentGoal, string> = {
  awareness: "Goal: awareness. Make people remember the brand; teach or entertain, light call to action.",
  engagement: "Goal: engagement. Invite replies: ask a question, run a poll-style prompt or a relatable observation.",
  leads: "Goal: leads. Give a concrete reason to get in touch and one clear next step (message us, book, call).",
  promotion: "Goal: promotion. Present the offer clearly with a single call to action. Only offers listed in the brand facts.",
};

// ─── Prompt ────────────────────────────────────────────────────────────

export function buildContentSystemPrompt(ctx: ContentContext, platforms: ContentPlatform[]): string {
  const facts = ctx.facts.length
    ? ctx.facts.map((f, i) => `### Fact sheet ${i + 1}: ${f.title}\n${f.content.slice(0, 2500)}`).join("\n\n")
    : "(No knowledge base articles matched this brief.)";
  const rules = platforms
    .map((p) => {
      const r = PLATFORM_RULES[p];
      return `- ${p} (${r.label}): max ${r.maxChars.toLocaleString("en-US")} characters including hashtags${r.linkInline ? " and the link" : ""}, ideally under ${r.idealChars.toLocaleString("en-US")}. ${r.style}`;
    })
    .join("\n");
  return `You are the social media copywriter for ${ctx.businessName || "this business"}. You write ready-to-post copy for each requested platform.

${ctx.brandContext || "No brand voice profile has been set up: write in a clear, friendly, professional voice."}

RULES (follow strictly):
1. Only state facts found in the brand voice or the fact sheets below. Never invent prices, discounts, offers, statistics, awards, guarantees, customer names or testimonials. If the brief asks for a detail you don't have, write around it.
2. Never use any phrase listed under "Never say", in any form or in a hashtag.
3. Write each platform natively; don't paste the same text everywhere.
4. Hashtags go in the hashtags field only, not in the body.
5. Write in the language of the brief unless it says otherwise.
6. Return exactly one variant per requested platform.

PLATFORMS:
${rules}

FACT SHEETS (from the knowledge base):
${facts}`;
}

export interface BriefInput {
  brief: string;
  goal?: ContentGoal | null;
  toneTweak?: string | null;
  linkUrl?: string | null;
  platforms: ContentPlatform[];
}

export function buildBriefMessage(input: BriefInput): string {
  const lines = [`<brief>\n${input.brief.trim()}\n</brief>`];
  if (input.goal) lines.push(GOAL_GUIDANCE[input.goal]);
  if (input.toneTweak?.trim()) lines.push(`Tone adjustment for this post: ${input.toneTweak.trim()}`);
  if (input.linkUrl) {
    lines.push(
      `Link to promote: ${input.linkUrl} (it is attached to the post on Facebook and LinkedIn and appended on X; on Instagram and TikTok say "link in bio").`
    );
  }
  lines.push(`Write one variant for each of: ${input.platforms.join(", ")}.`);
  return lines.join("\n\n");
}

export type RewriteAction = "regenerate" | "shorter" | "add_cta" | "translate" | "custom";

export function buildRewriteMessage(
  platform: ContentPlatform,
  current: VariantContent,
  action: RewriteAction,
  opts: { brief: string; locale?: string | null; instruction?: string | null; goal?: ContentGoal | null; toneTweak?: string | null; linkUrl?: string | null }
): string {
  const instruction =
    action === "shorter"
      ? "Make it noticeably shorter (about half the length) while keeping the hook and the call to action."
      : action === "add_cta"
        ? "Add one clear, specific call to action that fits the goal. Keep everything else."
        : action === "translate"
          ? `Translate it into ${opts.locale || "French"}, adapting idioms and hashtags for native speakers.`
          : action === "custom"
            ? `Apply this edit: ${opts.instruction?.trim() || "improve it"}`
            : "Write a fresh alternative with a different angle and hook.";
  const parts = [`<brief>\n${opts.brief.trim()}\n</brief>`];
  if (opts.goal) parts.push(GOAL_GUIDANCE[opts.goal]);
  if (opts.toneTweak?.trim()) parts.push(`Tone adjustment: ${opts.toneTweak.trim()}`);
  if (opts.linkUrl) parts.push(`Link to promote: ${opts.linkUrl}`);
  if (action !== "regenerate") {
    parts.push(`<current_${platform}_post>\n${composeText(platform, current)}\n</current_${platform}_post>`);
  }
  parts.push(`${instruction}\nReturn one variant, for ${platform}.`);
  return parts.join("\n\n");
}

// ─── Checks and enforcement ────────────────────────────────────────────

function toVariant(platform: ContentPlatform, m: ModelOutput["variants"][number] | undefined, linkUrl?: string | null) {
  return {
    platform,
    body: (m?.body ?? "").replace(/\r\n/g, "\n").trim(),
    hashtags: normalizeHashtags(m?.hashtags ?? []),
    imagePrompt: m?.imagePrompt?.trim() || null,
    linkUrl: PLATFORM_RULES[platform].clickableLinks ? linkUrl ?? null : null,
  };
}

/** A compact, model-facing description of what to fix. */
function describeErrors(platform: ContentPlatform, issues: VariantIssue[]) {
  return `- ${platform}: ${issues
    .filter((i) => i.severity === "error")
    .map((i) => i.message)
    .join(" ")}`;
}

/** Cut to the limit at a sentence (or word) boundary. */
function truncateTo(platform: ContentPlatform, v: VariantContent): VariantContent {
  const rule = PLATFORM_RULES[platform];
  let hashtags = normalizeHashtags(v.hashtags).slice(0, rule.maxHashtags);
  let body = v.body;
  const fits = (b: string, h: string[]) => platformLength(platform, composeText(platform, { ...v, body: b, hashtags: h })) <= rule.maxChars;
  while (!fits(body, hashtags) && hashtags.length > rule.idealHashtags[0]) hashtags = hashtags.slice(0, -1);
  if (fits(body, hashtags)) return { ...v, body, hashtags };
  const sentences = body.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [body];
  while (sentences.length > 1 && !fits(sentences.join("").trim(), hashtags)) sentences.pop();
  body = sentences.join("").trim();
  while (!fits(body, hashtags) && body.includes(" ")) body = body.slice(0, body.lastIndexOf(" ")).trimEnd() + "…";
  while (!fits(body, hashtags) && body.length > 1) body = body.slice(0, -2) + "…";
  return { ...v, body, hashtags };
}

/** Make a variant pass every hard rule, whatever the model returned. */
export function enforceHardLimits(platform: ContentPlatform, v: VariantContent, dontPhrases: string[]): VariantContent {
  let out: VariantContent = { ...v, hashtags: normalizeHashtags(v.hashtags) };
  if (findBannedPhrases(composeText(platform, out), dontPhrases).length) out = scrubBannedPhrases(out, dontPhrases);
  if (!PLATFORM_RULES[platform].clickableLinks) {
    out = { ...out, body: out.body.replace(/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+\.[a-z]{2,}[^\s]*/gi, "(link in bio)") };
  }
  return truncateTo(platform, out);
}

// ─── Model calls ───────────────────────────────────────────────────────

async function callModel(businessId: string, messages: AiMessage[]): Promise<AiResult & { data: ModelOutput }> {
  try {
    const result = await aiStructured(messages, modelOutputSchema, { businessId, task: "content", maxTokens: 8000 });
    await logUsage(businessId, CONTENT_USAGE_FEATURE, result);
    return result;
  } catch (e) {
    await logUsage(businessId, CONTENT_USAGE_FEATURE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", (e as Error).message);
    logger.warn("Content generation failed", { businessId, ...serializeError(e) });
    if (e instanceof AiRefusalError) {
      throw new AppError("The AI declined to write this post. Try rewording the brief.", { status: 422, code: "AI_REFUSED" });
    }
    throw new AppError("The AI couldn't write the posts just now. Please try again.", { status: 502, code: "AI_FAILED" });
  }
}

/**
 * Run one generation for the given platforms: ask, check, re-ask once for
 * failures, then enforce. Every returned variant passes the hard limits and
 * contains no banned phrase.
 */
export async function runGeneration(
  businessId: string,
  ctx: ContentContext,
  platforms: ContentPlatform[],
  userMessage: string,
  linkUrl?: string | null
): Promise<GenerationResult> {
  const system = buildContentSystemPrompt(ctx, platforms);
  const messages: AiMessage[] = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];
  const first = await callModel(businessId, messages);
  let aiCalls = 1;

  const pick = (out: ModelOutput, p: ContentPlatform) => out.variants.find((v) => v.platform === p);
  const variants = new Map(platforms.map((p) => [p, toVariant(p, pick(first.data, p), linkUrl)]));

  const failing = platforms.filter((p) => hasErrors(checkVariant(p, variants.get(p)!, ctx.dontPhrases)));
  if (failing.length) {
    const fixes = failing.map((p) => describeErrors(p, checkVariant(p, variants.get(p)!, ctx.dontPhrases))).join("\n");
    const retry = await callModel(businessId, [
      ...messages,
      { role: "assistant", content: JSON.stringify(first.data) },
      {
        role: "user",
        content: `Some variants break the rules:\n${fixes}\n\nRewrite only these platforms (${failing.join(", ")}) so they pass. Return just those variants.`,
      },
    ]);
    aiCalls++;
    for (const p of failing) {
      const fixed = pick(retry.data, p);
      if (fixed) variants.set(p, toVariant(p, fixed, linkUrl));
    }
  }

  const out: GeneratedVariant[] = platforms.map((p) => {
    const v = variants.get(p)!;
    const enforced = enforceHardLimits(p, v, ctx.dontPhrases);
    const final = { ...v, ...enforced };
    return { ...final, platform: p, issues: checkVariant(p, final, ctx.dontPhrases) };
  });
  const empty = out.filter((v) => !v.body);
  if (empty.length === out.length) {
    throw new AppError("The AI couldn't write usable posts for this brief. Try adding more detail.", { status: 502, code: "AI_EMPTY" });
  }
  return { variants: out.filter((v) => v.body), aiCalls };
}

export async function generateVariants(businessId: string, ctx: ContentContext, input: BriefInput): Promise<GenerationResult> {
  return runGeneration(businessId, ctx, input.platforms, buildBriefMessage(input), input.linkUrl);
}

export async function rewriteVariant(
  businessId: string,
  ctx: ContentContext,
  platform: ContentPlatform,
  current: VariantContent,
  action: RewriteAction,
  opts: Parameters<typeof buildRewriteMessage>[3]
): Promise<GeneratedVariant> {
  const res = await runGeneration(businessId, ctx, [platform], buildRewriteMessage(platform, current, action, opts), opts.linkUrl);
  return res.variants[0];
}
