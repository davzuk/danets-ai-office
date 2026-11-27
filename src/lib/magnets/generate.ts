import "server-only";
// AI-written lead magnets (Phase 2, workstream T): a checklist or short
// guide from one prompt, grounded in the brand voice and knowledge base.

import { z } from "zod";
import { AppError } from "@/lib/app-error";
import { logger, serializeError } from "@/lib/logger";
import { aiStructured, logUsage, AiRefusalError, EMPTY_USAGE, type AiMessage } from "@/lib/llm";
import { findBannedPhrases } from "@/lib/content/platforms";
import type { ContentContext } from "@/lib/content/generate";
import { magnetContentSchema, type MagnetContent, type MagnetStyle } from "./content";

export const MAGNET_USAGE_FEATURE = "lead_magnet";

const outputSchema = z.object({
  title: z.string().describe("A specific, benefit-led title, at most 80 characters."),
  description: z.string().describe("One or two sentences for the download page: who it's for and what they get."),
  bullets: z.array(z.string()).describe("Three or four short 'what you'll get' points for the download page."),
  intro: z.string().describe("A short opening paragraph for the document."),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        paragraph: z.string().describe("Optional short explanation; empty string if not needed."),
        items: z.array(z.string()).describe("Checklist points or key steps, each one sentence."),
      })
    )
    .describe("The body of the document."),
  closing: z.string().describe("A short closing line that invites the reader to get in touch. No invented offers."),
});

const STYLE_GUIDANCE: Record<MagnetStyle, string> = {
  checklist: "Write a practical checklist: 3 to 6 sections, each with 3 to 8 tick-box items the reader can act on. Paragraphs are optional and short.",
  guide: "Write a short guide: 4 to 7 numbered sections, each with a paragraph of 2 to 4 sentences and up to 4 key points.",
};

export function buildMagnetSystemPrompt(ctx: ContentContext, style: MagnetStyle): string {
  const facts = ctx.facts.length
    ? ctx.facts.map((f, i) => `### Fact sheet ${i + 1}: ${f.title}\n${f.content.slice(0, 2500)}`).join("\n\n")
    : "(No knowledge base articles matched this prompt.)";
  const never = ctx.dontPhrases.length ? ctx.dontPhrases.map((p) => `- ${p}`).join("\n") : "(none)";
  return `You write downloadable lead magnets (free PDFs that visitors get in exchange for their email) for ${ctx.businessName || "this business"}.

${ctx.brandContext || "No brand voice profile has been set up: write in a clear, friendly, professional voice."}

RULES (follow strictly):
1. Give genuinely useful, general advice on the topic. Only state facts about the business itself (prices, offers, guarantees, awards, statistics, customer names, testimonials) if they appear in the brand voice or the fact sheets below. Never invent them.
2. Never use any of these phrases: 
${never}
3. ${STYLE_GUIDANCE[style]}
4. Write in the language of the prompt unless it says otherwise.
5. No markdown, emojis or headings inside items; plain sentences only.

FACT SHEETS (from the knowledge base):
${facts}`;
}

export interface GeneratedMagnet {
  title: string;
  description: string;
  bullets: string[];
  content: MagnetContent;
}

const clip = (s: string, n: number) => s.trim().slice(0, n);

/** Map the model's output to the stored shape, trimming to the editor's limits. */
export function toMagnet(out: z.infer<typeof outputSchema>): GeneratedMagnet {
  const sections = out.sections
    .map((s) => ({
      heading: clip(s.heading, 160),
      paragraph: clip(s.paragraph ?? "", 2000),
      items: s.items.map((i) => clip(i, 400)).filter(Boolean).slice(0, 25),
    }))
    .filter((s) => s.heading && (s.paragraph || s.items.length))
    .slice(0, 15);
  const content = magnetContentSchema.safeParse({ intro: clip(out.intro, 2000), sections, closing: clip(out.closing, 1000) });
  if (!content.success) {
    throw new AppError("The AI couldn't write a usable document for this prompt. Try adding more detail.", { status: 502, code: "AI_EMPTY" });
  }
  return {
    title: clip(out.title, 160) || "Free guide",
    description: clip(out.description, 1000),
    bullets: out.bullets.map((b) => clip(b, 200)).filter(Boolean).slice(0, 6),
    content: content.data,
  };
}

function allText(m: GeneratedMagnet) {
  return [m.title, m.description, ...m.bullets, m.content.intro, m.content.closing, ...m.content.sections.flatMap((s) => [s.heading, s.paragraph, ...s.items])].join("\n");
}

export async function generateMagnet(businessId: string, ctx: ContentContext, prompt: string, style: MagnetStyle): Promise<GeneratedMagnet> {
  const messages: AiMessage[] = [
    { role: "system", content: buildMagnetSystemPrompt(ctx, style) },
    { role: "user", content: `<prompt>\n${prompt.trim()}\n</prompt>` },
  ];
  const call = async (msgs: AiMessage[]) => {
    try {
      const result = await aiStructured(msgs, outputSchema, { businessId, task: "content", maxTokens: 6000 });
      await logUsage(businessId, MAGNET_USAGE_FEATURE, result);
      return toMagnet(result.data);
    } catch (e) {
      if (e instanceof AppError) throw e;
      await logUsage(businessId, MAGNET_USAGE_FEATURE, EMPTY_USAGE, "error", (e as Error).message);
      logger.warn("Lead magnet generation failed", { businessId, ...serializeError(e) });
      if (e instanceof AiRefusalError) throw new AppError("The AI declined to write this. Try rewording the prompt.", { status: 422, code: "AI_REFUSED" });
      throw new AppError("The AI couldn't write the document just now. Please try again.", { status: 502, code: "AI_FAILED" });
    }
  };
  let magnet = await call(messages);
  const banned = findBannedPhrases(allText(magnet), ctx.dontPhrases);
  if (banned.length) {
    magnet = await call([
      ...messages,
      { role: "assistant", content: JSON.stringify(magnet) },
      { role: "user", content: `Rewrite it without these phrases: ${banned.join(", ")}. Keep everything else.` },
    ]);
  }
  return magnet;
}
