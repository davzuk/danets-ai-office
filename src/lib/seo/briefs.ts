import "server-only";
// AI content briefs (Phase 3, workstream Y). From a search query (usually an
// opportunity), the AI plans a page: the search intent, a title and H1, an
// outline, the questions to answer and the facts to use. Facts come only
// from the knowledge base; anything the page would need that isn't there is
// marked "[Add …]", as the page builder (R) does. Tenants copy or download
// the brief; Danets never publishes to their site.

import { z } from "zod";
import type { ContentBrief } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { aiStructured, AiRefusalError, logUsage } from "@/lib/llm";
import { findBannedPhrases } from "@/lib/content/platforms";
import { loadContentContext } from "@/lib/content/context";
import { addDaysIso, aggregateByKey, fromIso, lastFinalDay, QUERY_KIND, toIso } from "./search";
import { normalizeKeyword, type SeoActor } from "./keywords";

export const BRIEF_FEATURE = "seo_brief";
/** Briefs kept per tenant (oldest removed first). */
export const KEEP_BRIEFS = 50;
const CLUSTER_DAYS = 90;
const CLUSTER_MAX = 15;

const STOPWORDS = new Set(
  "the and for with from your you are near best how what why when where who which can does should into about this that their them our out get its was has have not but any all than then there here".split(" ")
);
const QUESTION_START = /^(how|what|why|when|where|who|which|can|could|does|do|is|are|should|will|would)\b/;

const tokens = (q: string) => q.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !STOPWORDS.has(t));

/**
 * Related searches from the site's own Search Console data: queries sharing
 * at least half of the target's meaningful words, most impressions first.
 * Pure; exported for tests.
 */
export function queryCluster(query: string, candidates: { key: string; impressions: number }[], max = CLUSTER_MAX): string[] {
  const want = tokens(query);
  if (!want.length) return [];
  const need = Math.max(1, Math.ceil(want.length / 2));
  return candidates
    .filter((c) => c.key !== query)
    .filter((c) => {
      const have = new Set(tokens(c.key));
      return want.filter((t) => have.has(t)).length >= need;
    })
    .sort((a, b) => b.impressions - a.impressions || a.key.localeCompare(b.key))
    .slice(0, max)
    .map((c) => c.key);
}

/** The cluster's searches phrased as questions. Pure. */
export const questionQueries = (cluster: string[]) => cluster.filter((q) => QUESTION_START.test(q));

// ─── What the model returns ──────────────────────────────────────────

export const SEARCH_INTENTS = ["informational", "commercial", "transactional", "local", "navigational"] as const;

export const briefSchema = z.object({
  intent: z.string().describe("One or two sentences: what someone searching this wants to find or do."),
  intentType: z.enum(SEARCH_INTENTS),
  title: z.string().describe("The page title (<title>), 50-60 characters, main words first."),
  metaDescription: z.string().describe("120-155 characters."),
  h1: z.string(),
  wordCount: z.number().int().describe("A sensible length for the page, in words."),
  outline: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })),
  questions: z.array(z.object({ question: z.string(), answer: z.string().describe("A short answer from the fact sheets, or an [Add …] placeholder.") })),
  facts: z.array(z.object({ fact: z.string(), source: z.string().describe("The exact title of the fact sheet it comes from.") })),
  gaps: z.array(z.string()).describe('What the business must add before publishing, each written as "[Add …]".'),
});
export type BriefData = z.infer<typeof briefSchema>;

export interface BriefFacts {
  businessName: string;
  brandContext: string;
  dontPhrases: string[];
  facts: { title: string; content: string }[];
}

export function briefPrompt(query: string, cluster: string[], ctx: BriefFacts, context?: string | null) {
  const facts = ctx.facts.length
    ? ctx.facts.map((f, i) => `### Fact sheet ${i + 1}: ${f.title}\n${f.content.slice(0, 2500)}`).join("\n\n")
    : "(No knowledge base articles matched this search.)";
  const system = `You plan web pages for ${ctx.businessName || "a small business"} that answer a Google search well. You write a content brief for the person who will write the page. Reply with JSON only.

RULES (follow strictly):
1. Facts about the business (services, prices, areas served, years, numbers, guarantees, awards, staff, customers, testimonials) may come ONLY from the fact sheets below. List each one you use in "facts" with the exact fact sheet title as its "source".
2. Where the page needs a fact the fact sheets don't give, write a placeholder in square brackets starting with "Add", e.g. "[Add your call-out fee]" or "[Add a real customer quote]", and list it in "gaps". Never guess.
3. General knowledge about the topic (how something works, what to look for) is fine in the outline, but never present it as a claim about this business.
4. Plan one page for this search: match the intent, cover the related searches where they fit, and answer the question-style searches in "questions".
5. Keep the outline to 4-8 sections, each with 2-5 short points. Write in the language of the search.${ctx.dontPhrases.length ? `\n6. Never use these phrases: ${ctx.dontPhrases.map((p) => `"${p}"`).join(", ")}.` : ""}

Brand voice:
${ctx.brandContext || "No brand voice profile has been set up: write in a clear, friendly, professional voice."}

FACT SHEETS (from the knowledge base):
${facts}`;
  const user = `Search: "${query}"
Related searches people used to find this site: ${cluster.length ? cluster.map((c) => `"${c}"`).join(", ") : "(none)"}
${context ? `What the data shows: ${context}\n` : ""}
Return the brief.`;
  return { system, user };
}

// ─── Checking and formatting (pure) ──────────────────────────────────

const PLACEHOLDER = /\[Add[^\]]*\]/g;

/**
 * Keep only facts whose source is one of the fact sheets given, and gather
 * every "[Add …]" placeholder into the gaps. Pure; exported for tests.
 */
export function checkBrief(data: BriefData, factTitles: string[]): { brief: BriefData; dropped: string[] } {
  const known = new Set(factTitles.map((t) => t.trim().toLowerCase()));
  const kept = data.facts.filter((f) => known.has(f.source.trim().toLowerCase()));
  const dropped = data.facts.filter((f) => !kept.includes(f)).map((f) => f.fact);
  const text = [
    data.title,
    data.metaDescription,
    data.h1,
    ...data.outline.flatMap((s) => [s.heading, ...s.points]),
    ...data.questions.flatMap((q) => [q.question, q.answer]),
    ...data.gaps,
  ].join("\n");
  // Gaps the model wrote without brackets ("your call-out fee") become placeholders too.
  const bare = data.gaps.map((g) => g.trim()).filter((g) => g && !/\[Add/i.test(g)).map((g) => `[Add ${g.replace(/^add\s+/i, "").replace(/\.$/, "")}]`);
  const gaps = [...new Set([...(text.match(PLACEHOLDER) ?? []), ...bare])];
  return { brief: { ...data, facts: kept, wordCount: Math.min(Math.max(data.wordCount || 0, 300), 3000), gaps }, dropped };
}

export function briefMarkdown(b: BriefData, meta: { query: string; businessName: string; cluster: string[] }): string {
  const lines = [
    `# Content brief: ${meta.query}`,
    "",
    `*For ${meta.businessName || "your business"}. Replace every [Add …] before publishing.*`,
    "",
    "## Search intent",
    `${b.intent} (${b.intentType})`,
    "",
    "## Page basics",
    `- **Title:** ${b.title}`,
    `- **Meta description:** ${b.metaDescription}`,
    `- **H1:** ${b.h1}`,
    `- **Length:** about ${b.wordCount} words`,
    "",
    "## Outline",
    ...b.outline.flatMap((s) => [`### ${s.heading}`, ...s.points.map((p) => `- ${p}`), ""]),
  ];
  if (b.questions.length) lines.push("## Questions to answer", ...b.questions.flatMap((q) => [`**${q.question}**`, q.answer, ""]));
  lines.push("## Facts to use", ...(b.facts.length ? b.facts.map((f) => `- ${f.fact} *(from "${f.source}")*`) : ["- None found in your knowledge base."]), "");
  if (b.gaps.length) lines.push("## Still to add", ...b.gaps.map((g) => `- ${g}`), "");
  if (meta.cluster.length) lines.push("## Related searches", ...meta.cluster.map((c) => `- ${c}`), "");
  return lines.join("\n").trim() + "\n";
}

/** A prompt for the platform's AI page builder (R), for platform-built sites. Pure. */
export function briefToPagePrompt(b: BriefData, query: string): string {
  return [
    `A page that ranks for the Google search "${query}" (${b.intentType} intent: ${b.intent})`,
    `Headline: ${b.h1}`,
    `Sections: ${b.outline.map((s) => `${s.heading} (${s.points.join("; ")})`).join(" | ")}`,
    b.questions.length ? `FAQ: ${b.questions.map((q) => q.question).join(" | ")}` : "",
    b.facts.length ? `Use these facts: ${b.facts.map((f) => f.fact).join(" | ")}` : "",
    b.gaps.length ? `Leave placeholders for: ${b.gaps.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Creating and reading ────────────────────────────────────────────

export const createBriefSchema = z.union([
  z.object({ opportunityId: z.string().min(1) }),
  z.object({ query: z.string().min(1).max(200), propertyId: z.string().min(1).optional() }),
]);

const opportunityContext: Record<string, (o: { position: number; impressions: number; pages: unknown }) => string> = {
  almost_page_one: (o) => `the site shows at an average position of ${o.position.toFixed(1)} (page two) with ${o.impressions} impressions in 28 days, so a stronger page could reach page one.`,
  low_ctr: (o) => `the site ranks around position ${o.position.toFixed(1)} but few searchers click, so the page must match the intent better.`,
  cannibalisation: (o) =>
    `${Array.isArray(o.pages) ? o.pages.length : "several"} of the site's pages compete for this search; plan the single page that should own it.`,
};

export async function createBrief(actor: SeoActor, input: z.infer<typeof createBriefSchema>, now = new Date()) {
  let query: string;
  let propertyId: string | null = null;
  let opportunityId: string | null = null;
  let context: string | null = null;
  if ("opportunityId" in input) {
    const o = await db.seoOpportunity.findFirst({ where: { id: input.opportunityId, businessId: actor.businessId } });
    if (!o) throw new AppError("Opportunity not found", { status: 404, code: "NOT_FOUND" });
    query = o.query;
    propertyId = o.propertyId;
    opportunityId = o.id;
    context = opportunityContext[o.kind]?.(o) ?? null;
  } else {
    const q = normalizeKeyword(input.query);
    if (!q) throw new AppError("Enter a search of up to 200 characters.", { status: 400, code: "INVALID_REQUEST" });
    query = q;
    const p = input.propertyId
      ? await db.searchProperty.findFirst({ where: { id: input.propertyId, businessId: actor.businessId } })
      : await db.searchProperty.findFirst({ where: { businessId: actor.businessId }, orderBy: { createdAt: "asc" } });
    propertyId = p?.id ?? null;
  }

  let cluster: string[] = [];
  if (propertyId) {
    const prop = await db.searchProperty.findUnique({ where: { id: propertyId }, select: { syncedThrough: true } });
    const to = prop?.syncedThrough ? toIso(prop.syncedThrough) : lastFinalDay(now);
    const rows = await db.searchMetricDaily.findMany({
      where: { propertyId, kind: QUERY_KIND, date: { gte: fromIso(addDaysIso(to, -(CLUSTER_DAYS - 1))), lte: fromIso(to) } },
      select: { key: true, clicks: true, impressions: true, position: true },
    });
    cluster = queryCluster(query, aggregateByKey(rows));
  }

  const ctx = await loadContentContext(actor.businessId, [query, ...cluster.slice(0, 3)].join(" "));
  const { system, user } = briefPrompt(query, cluster, ctx, context);
  let result;
  try {
    result = await aiStructured(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      briefSchema,
      { businessId: actor.businessId, task: "content", maxTokens: 3000 }
    );
    await logUsage(actor.businessId, BRIEF_FEATURE, result);
  } catch (e) {
    await logUsage(actor.businessId, BRIEF_FEATURE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", (e as Error).message);
    if (e instanceof AiRefusalError) throw new AppError("The AI declined to write a brief for this search.", { status: 422, code: "AI_REFUSED" });
    throw new AppError("The AI couldn't write the brief just now. Please try again.", { status: 502, code: "AI_FAILED" });
  }

  const { brief, dropped } = checkBrief(result.data, ctx.facts.map((f) => f.title));
  const markdown = briefMarkdown(brief, { query, businessName: ctx.businessName, cluster });
  const banned = findBannedPhrases(markdown, ctx.dontPhrases);
  const row = await db.contentBrief.create({
    data: {
      businessId: actor.businessId,
      propertyId,
      opportunityId,
      query: query.slice(0, 500),
      title: brief.title.slice(0, 300) || query.slice(0, 300),
      brief: { ...brief, cluster },
      markdown,
      gaps: brief.gaps.length,
      createdById: actor.userId ?? null,
      createdByName: actor.name.slice(0, 120),
    },
  });
  await pruneBriefs(actor.businessId);
  await logActivity({ businessId: actor.businessId, userId: actor.userId, userName: actor.name, action: "create", module: "seo", description: `Wrote a content brief for "${query}"` });
  return {
    brief: publicBrief(row),
    warnings: [
      ...dropped.map((f) => `Left out a fact that isn't in your knowledge base: "${f.slice(0, 80)}"`),
      ...banned.map((p) => `Uses "${p}", which the brand voice says never to say.`),
    ],
  };
}

async function pruneBriefs(businessId: string) {
  const old = await db.contentBrief.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, skip: KEEP_BRIEFS, select: { id: true } });
  if (old.length) await db.contentBrief.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export const briefSummary = (b: ContentBrief) => ({ id: b.id, query: b.query, title: b.title, gaps: b.gaps, opportunityId: b.opportunityId, createdByName: b.createdByName, createdAt: b.createdAt });
export const publicBrief = (b: ContentBrief) => ({ ...briefSummary(b), brief: b.brief as BriefData & { cluster?: string[] }, markdown: b.markdown });

export async function listBriefs(businessId: string, take = KEEP_BRIEFS) {
  const rows = await db.contentBrief.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take });
  return rows.map(briefSummary);
}

export async function getBrief(businessId: string, id: string) {
  const b = await db.contentBrief.findFirst({ where: { id, businessId } });
  if (!b) throw new AppError("Brief not found", { status: 404, code: "NOT_FOUND" });
  return b;
}

export async function deleteBrief(actor: SeoActor, id: string) {
  const b = await getBrief(actor.businessId, id);
  if (actor.role !== "admin" && b.createdById !== actor.userId) throw new AppError("Only admins can delete other people's briefs.", { status: 403, code: "FORBIDDEN" });
  await db.contentBrief.delete({ where: { id: b.id } });
}

/** A safe file name for downloads. Pure. */
export const briefFileName = (query: string, ext: string) => `brief-${query.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "page"}.${ext}`;
