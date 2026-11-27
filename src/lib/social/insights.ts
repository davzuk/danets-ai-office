// The weekly AI "what worked / what next" note (Phase 1 M). Reads the last 4
// weeks of post metrics and leads by post, and writes, in the brand's voice,
// what worked, what didn't and three post ideas that open in the Studio.

import { z } from "zod";
import type { ContentInsight } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { createNotification } from "@/lib/activity";
import { getBrandContext } from "@/lib/brand";
import { CONTENT_GOALS, CONTENT_PLATFORMS } from "@/lib/content/platforms";
import { aiStructured, logUsage, AiRefusalError, type AiMessage } from "@/lib/llm";
import { logger, serializeError } from "@/lib/logger";
import { checkMonthlyAiQuota } from "@/lib/plan-limits";
import { searchSummary } from "@/lib/seo/search";
import { buildAnalyticsReport, type AnalyticsReport, type PostStat } from "./analytics";

export const INSIGHT_USAGE_FEATURE = "content_insight";
export const INSIGHT_PERIOD_DAYS = 28;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const insightSchema = z.object({
  headline: z.string().describe("One sentence summing up the month, with the most useful number in it."),
  worked: z.array(z.string()).min(1).max(4).describe("What worked, each a specific, evidence-based observation."),
  didnt: z.array(z.string()).min(1).max(4).describe("What didn't work or is missing, each specific."),
  ideas: z
    .array(
      z.object({
        title: z.string().describe("Short label for the idea."),
        brief: z.string().describe("A Content Studio brief: 2-4 sentences saying what the post is about and why now."),
        platforms: z.array(z.enum(CONTENT_PLATFORMS)).min(1),
        goal: z.enum(CONTENT_GOALS).nullable(),
      })
    )
    .length(3),
});
export type InsightContent = z.infer<typeof insightSchema>;

const pct = (r: number | null) => (r == null ? null : Math.round(r * 1000) / 10);

function postFacts(p: PostStat) {
  return {
    platform: p.platform,
    published: p.publishedAt.slice(0, 16).replace("T", " ") + " UTC",
    campaign: p.campaignTag,
    text: p.excerpt,
    views: p.metrics?.impressions ?? null,
    reach: p.metrics?.reach ?? null,
    engagements: p.metrics?.engagements ?? null,
    clicks: p.metrics?.clicks ?? null,
    engagementRatePct: pct(p.engagementRate),
    siteVisits: p.visits,
    leads: p.leads,
  };
}

/** The numbers the model is given: compact, with no personal data. Pure. */
export function insightStats(report: AnalyticsReport) {
  const measured = report.posts.filter((p) => p.engagementRate != null);
  const bottom = [...measured].sort((a, b) => (a.engagementRate ?? 0) - (b.engagementRate ?? 0)).slice(0, 3);
  const slots = [...report.heatmap]
    .filter((c) => c.posts >= 1)
    .sort((a, b) => b.avgRate - a.avgRate)
    .slice(0, 3)
    .map((c) => ({ when: `${WEEKDAYS[c.weekday]} ${String(c.block * 3).padStart(2, "0")}:00–${String(c.block * 3 + 3).padStart(2, "0")}:00`, posts: c.posts, avgEngagementRatePct: pct(c.avgRate) }));
  return {
    periodDays: report.range.days,
    timezone: report.range.timezone,
    postsPublished: report.posts.length,
    postsWithMetrics: measured.length,
    byPlatform: report.totals.map((t) => ({ ...t, engagementRate: undefined, engagementRatePct: pct(t.engagementRate) })),
    topByEngagement: report.topByEngagement.map(postFacts),
    topByLeads: report.topByLeads.map(postFacts),
    lowest: bottom.map(postFacts),
    bestSlots: slots,
    followerGrowth: report.followers.map((f) => ({ account: f.name, platform: f.platform, growth: f.growth, followers: f.points.at(-1)?.followers ?? null })),
  };
}
export type InsightStats = ReturnType<typeof insightStats>;

export function insightMessages(brandContext: string, stats: InsightStats, search?: string | null): AiMessage[] {
  const rules = [
    "Rules:",
    "- Base every observation on the numbers given. Quote a number when it makes the point. Never invent results.",
    "- Leads matter more than likes: call out posts that produced site visits or leads.",
    "- Engagement rate is engagements ÷ reach (or views when reach isn't reported).",
    "- With few posts or little data, say so plainly and focus on what to try next.",
    "- Ideas must fit the brand and use only facts in the brand context. Each brief should be ready to paste into the content generator.",
    "- Write in plain language for a busy owner. No jargon, no hype.",
  ];
  if (search) {
    rules.push("- Search Console numbers are provided too: fold the click trend and any query movers into what worked / what didn't where they matter, but never invent search figures beyond what's given.");
  }
  const system = [
    "You are the social media strategist for this business. Each Monday you review the last four weeks of the business's own posts and write a short, practical note for the owner.",
    "",
    brandContext,
    "",
    ...rules,
  ].join("\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Here are the numbers for the last ${stats.periodDays} days (times in ${stats.timezone}):\n\n${JSON.stringify(stats, null, 2)}${search ? `\n\n${search}` : ""}\n\nWrite this week's note.`,
    },
  ];
}

export function toPublicInsight(row: ContentInsight) {
  return {
    id: row.id,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    createdAt: row.createdAt.toISOString(),
    content: row.content as unknown as InsightContent,
  };
}
export type PublicInsight = ReturnType<typeof toPublicInsight>;

export async function latestInsight(businessId: string): Promise<PublicInsight | null> {
  const row = await db.contentInsight.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } });
  return row ? toPublicInsight(row) : null;
}

export class InsightSkipped extends Error {
  constructor(public readonly reason: "quota" | "no_posts") {
    super(reason === "quota" ? "No AI credits left this month." : "No published posts to review yet.");
    this.name = "InsightSkipped";
  }
}

/**
 * Write and store one insight. `requirePosts` (the weekly job) skips tenants
 * that published nothing in the period, so credits aren't spent on an empty
 * report; a manual request still gets ideas.
 */
export async function generateInsight(
  businessId: string,
  opts: { now?: Date; requirePosts?: boolean; notify?: boolean } = {}
): Promise<PublicInsight> {
  const now = opts.now ?? new Date();
  const quota = await checkMonthlyAiQuota(businessId);
  if (!quota.allowed) throw new InsightSkipped("quota");
  const report = await buildAnalyticsReport(businessId, INSIGHT_PERIOD_DAYS, now);
  if (opts.requirePosts && report.posts.length === 0) throw new InsightSkipped("no_posts");

  const stats = insightStats(report);
  // Search Console context is best-effort: a tenant without a property (or a
  // broken one) must not stop the social insight from being written.
  const search = await searchSummary(businessId).catch(() => null);
  const messages = insightMessages(await getBrandContext(businessId), stats, search);
  let content: InsightContent;
  try {
    const result = await aiStructured(messages, insightSchema, { businessId, task: "plan", maxTokens: 4000 });
    await logUsage(businessId, INSIGHT_USAGE_FEATURE, result);
    content = result.data;
  } catch (e) {
    await logUsage(businessId, INSIGHT_USAGE_FEATURE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error", (e as Error).message);
    logger.warn("Content insight failed", { businessId, ...serializeError(e) });
    if (e instanceof AiRefusalError) throw new AppError("The AI declined to write this week's insight.", { status: 422, code: "AI_REFUSED" });
    throw new AppError("The AI couldn't write the insight just now. Please try again.", { status: 502, code: "AI_FAILED" });
  }

  const row = await db.contentInsight.create({
    data: {
      businessId,
      periodStart: new Date(report.range.from),
      periodEnd: new Date(report.range.to),
      content: content as object,
      stats: stats as object,
    },
  });
  if (opts.notify !== false) {
    await createNotification({
      businessId,
      type: "content_insight",
      title: "Your weekly content insight is ready",
      message: content.headline,
      data: { view: "social", insightId: row.id, headline: content.headline, ideas: content.ideas.map((i) => i.title) },
    });
  }
  return toPublicInsight(row);
}
