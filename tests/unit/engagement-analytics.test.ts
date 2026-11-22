import { describe, expect, it } from "vitest";
import { campaignSlug, tagLink, utmParams } from "@/lib/social/utm";
import { classifyChannel } from "@/lib/attribution";
import {
  METRIC_STEPS_MS,
  facebookPostMetrics,
  fetchInsights,
  instagramPostMetrics,
  linkedinPostMetrics,
  metricsRunAt,
  readInsights,
  skippable,
} from "@/lib/social/metrics";
import { PublishError, type GraphClient } from "@/lib/social/publish/meta-http";
import type { LinkedInClient } from "@/lib/social/publish/linkedin";
import { engagementRate, postingHeatmap, topPosts, totalsByPlatform, type PostStat } from "@/lib/social/analytics";
import { insightSchema, insightStats } from "@/lib/social/insights";
import { SCHEDULES, windowStart } from "@/lib/jobs/schedules";

const utm = { platform: "facebook", scheduledPostId: "sp1", postId: "p1" };

describe("UTM tagging", () => {
  it("tags links and keeps the author's own tags", () => {
    const u = new URL(tagLink("https://acme.test/offer?ref=x#top", { ...utm, campaignTag: "Spring Sale 2026!" })!);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      ref: "x",
      utm_source: "facebook",
      utm_medium: "social",
      utm_campaign: "spring-sale-2026",
      utm_content: "sp1",
    });
    expect(u.hash).toBe("#top");
    const kept = new URL(tagLink("https://acme.test/?utm_campaign=mine", utm)!);
    expect(kept.searchParams.get("utm_campaign")).toBe("mine");
    expect(kept.searchParams.get("utm_content")).toBe("sp1");
  });

  it("leaves non-web and missing links alone", () => {
    expect(tagLink(null, utm)).toBeNull();
    expect(tagLink("not a url", utm)).toBe("not a url");
    expect(tagLink("mailto:a@b.c", utm)).toBe("mailto:a@b.c");
  });

  it("falls back to the post id as campaign, and is classed as organic social", () => {
    expect(utmParams(utm).utm_campaign).toBe("post-p1");
    expect(campaignSlug("  ")).toBe("");
    const p = utmParams({ ...utm, platform: "linkedin", campaignTag: "Q4" });
    expect(classifyChannel({ source: p.utm_source, medium: p.utm_medium, campaign: p.utm_campaign }).channel).toBe("social_organic");
  });
});

describe("metrics schedule", () => {
  it("runs at 1h, 24h, 72h, 7d then weekly to 5 weeks", () => {
    const t0 = new Date("2026-11-20T10:00:00Z");
    expect(metricsRunAt(t0, 0)!.toISOString()).toBe("2026-11-20T11:00:00.000Z");
    expect(metricsRunAt(t0, 2)!.toISOString()).toBe("2026-11-23T10:00:00.000Z");
    expect(metricsRunAt(t0, METRIC_STEPS_MS.length - 1)!.toISOString()).toBe("2026-12-25T10:00:00.000Z");
    expect(metricsRunAt(t0, METRIC_STEPS_MS.length)).toBeNull();
  });

  it("puts the weekly insight on Mondays at 06:00 UTC", () => {
    const s = SCHEDULES.find((x) => x.job.type === "social.insights-weekly")!;
    const start = windowStart(new Date("2026-11-26T15:00:00Z"), s.everyMs, s.offsetMs);
    expect(start.toISOString()).toBe("2026-11-23T06:00:00.000Z");
    expect(start.getUTCDay()).toBe(1);
  });
});

/** A Graph client answering from a table of path → response (or error). */
function graph(routes: Record<string, unknown | ((params: Record<string, string>) => unknown)>) {
  const calls: { path: string; params: Record<string, string> }[] = [];
  const client: GraphClient = {
    post: async () => {
      throw new Error("no posts");
    },
    get: async <T,>(path: string, params: Record<string, string> = {}) => {
      calls.push({ path, params });
      const r = routes[path];
      const v = typeof r === "function" ? (r as (p: Record<string, string>) => unknown)(params) : r;
      if (v instanceof Error) throw v;
      if (v === undefined) throw new PublishError("Unsupported get request", "content", 100);
      return v as T;
    },
  };
  return { client, calls };
}

describe("Meta metrics", () => {
  it("reads insight values, including total_value and breakdown objects", () => {
    expect(
      readInsights([
        { name: "views", values: [{ value: 3 }, { value: 10 }] },
        { name: "reach", total_value: { value: 7 } },
        { name: "post_clicks_by_type", values: [{ value: { "link clicks": 4, other: 1 } }] },
      ])
    ).toEqual({ views: 10, reach: 7, post_clicks_by_type: 5 });
  });

  it("falls back to one metric at a time when one is unsupported", async () => {
    const { client, calls } = graph({
      "/m1/insights": (p: Record<string, string>) =>
        p.metric.includes(",") || p.metric === "saved"
          ? new PublishError("(#100) metric saved not supported", "content", 100)
          : { data: [{ name: p.metric, values: [{ value: 5 }] }] },
    });
    const out = await fetchInsights(client, "/m1/insights", ["views", "saved", "reach"]);
    expect(out).toEqual({ views: 5, reach: 5 });
    expect(calls).toHaveLength(4);
  });

  it("skips missing-permission errors but not expired tokens or throttling", async () => {
    expect(skippable(new PublishError("no perm", "auth", 10))).toBe(true);
    expect(skippable(new PublishError("no perm", "auth", 200))).toBe(true);
    expect(skippable(new PublishError("expired", "auth", 190))).toBe(false);
    expect(skippable(new PublishError("slow down", "retry", 4))).toBe(false);
    const { client } = graph({ "/x/insights": new PublishError("slow down", "retry", 4) });
    await expect(fetchInsights(client, "/x/insights", ["a", "b"])).rejects.toMatchObject({ kind: "retry" });
  });

  it("combines Facebook fields and insights", async () => {
    const { client } = graph({
      "/123_456": { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } } },
      "/123_456/insights": {
        data: [
          { name: "post_media_view", values: [{ value: 900 }] },
          { name: "post_total_media_view_unique", values: [{ value: 600 }] },
          { name: "post_clicks", values: [{ value: 40 }] },
        ],
      },
    });
    const m = await facebookPostMetrics(client, "123_456");
    expect(m).toMatchObject({ impressions: 900, reach: 600, clicks: 40, comments: 3, shares: 0, engagements: 15, saves: null });
  });

  it("maps Instagram media insights", async () => {
    const { client } = graph({
      "/ig1/insights": {
        data: ["views:500", "reach:300", "likes:20", "comments:4", "shares:2", "saved:6", "total_interactions:32"].map((s) => {
          const [name, v] = s.split(":");
          return { name, values: [{ value: Number(v) }] };
        }),
      },
    });
    expect(await instagramPostMetrics(client, "ig1")).toMatchObject({ impressions: 500, reach: 300, engagements: 32, saves: 6, shares: 2, comments: 4 });
  });
});

describe("LinkedIn metrics", () => {
  it("reads share statistics for the post", async () => {
    const paths: string[] = [];
    const client: LinkedInClient = {
      json: async <T,>(_m: string, path: string) => {
        paths.push(path);
        return {
          data: { elements: [{ totalShareStatistics: { impressionCount: 800, uniqueImpressionsCount: 500, clickCount: 30, likeCount: 10, commentCount: 2, shareCount: 1 } }] } as T,
          headers: new Headers(),
        };
      },
      upload: async () => new Headers(),
    };
    const m = await linkedinPostMetrics(client, "42", "urn:li:share:99");
    expect(m).toMatchObject({ impressions: 800, reach: 500, clicks: 30, engagements: 13 });
    expect(paths[0]).toBe(
      "/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A42&shares=List(urn%3Ali%3Ashare%3A99)"
    );
    await linkedinPostMetrics(client, "42", "urn:li:ugcPost:7");
    expect(paths[1]).toContain("&ugcPosts=List(urn%3Ali%3AugcPost%3A7)");
  });
});

function stat(over: Partial<PostStat> & { id: string }): PostStat {
  const metrics = over.metrics === undefined ? null : over.metrics;
  return {
    postId: "p",
    title: over.id,
    excerpt: "",
    platform: "facebook",
    accountName: "Acme",
    publishedAt: "2026-11-16T09:30:00Z",
    permalink: null,
    campaignTag: null,
    visits: 0,
    leads: 0,
    ...over,
    metrics,
    engagementRate: engagementRate(metrics),
  };
}
const m = (engagements: number, reach: number | null, impressions: number | null = null) => ({
  impressions,
  reach,
  engagements,
  clicks: null,
  comments: null,
  shares: null,
  saves: null,
  capturedAt: "2026-11-17T00:00:00Z",
});

describe("dashboard aggregation", () => {
  const posts = [
    stat({ id: "a", metrics: m(50, 1000), leads: 2, visits: 9 }),
    stat({ id: "b", metrics: m(10, null, 500), publishedAt: "2026-11-17T19:00:00Z" }),
    stat({ id: "c", platform: "linkedin", metrics: m(30, 200), leads: 1 }),
    stat({ id: "d", platform: "linkedin" }), // marked as posted by hand: no metrics
  ];

  it("computes engagement rate against reach, then views", () => {
    expect(posts[0].engagementRate).toBe(0.05);
    expect(posts[1].engagementRate).toBe(0.02);
    expect(posts[3].engagementRate).toBeNull();
  });

  it("totals by platform with a weighted rate", () => {
    const t = totalsByPlatform(posts);
    expect(t.find((x) => x.platform === "facebook")).toMatchObject({ posts: 2, engagements: 60, leads: 2, visits: 9, engagementRate: 60 / 1500 });
    expect(t.find((x) => x.platform === "linkedin")).toMatchObject({ posts: 2, engagementRate: 30 / 200, leads: 1 });
  });

  it("ranks top posts by rate and by leads", () => {
    expect(topPosts(posts, "engagement").map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(topPosts(posts, "leads").map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("buckets the heatmap in the tenant's zone", () => {
    const utc = postingHeatmap(posts, "UTC");
    expect(utc.find((c) => c.weekday === 0 && c.block === 3)).toMatchObject({ posts: 2 }); // Mon 09:30 ×2
    const lagos = postingHeatmap([posts[1]], "Africa/Lagos"); // Tue 19:00 UTC = 20:00 Lagos
    expect(lagos).toEqual([{ weekday: 1, block: 6, posts: 1, avgRate: 0.02 }]);
  });

  it("gives the AI compact stats without contact data", () => {
    const stats = insightStats({
      range: { days: 28, from: "", to: "", timezone: "UTC" },
      totals: totalsByPlatform(posts),
      trend: [],
      topByEngagement: topPosts(posts, "engagement"),
      topByLeads: topPosts(posts, "leads"),
      heatmap: postingHeatmap(posts, "UTC"),
      followers: [{ socialAccountId: "s", name: "Acme", platform: "facebook_page", points: [{ date: "2026-11-01", followers: 100 }, { date: "2026-11-20", followers: 120 }], growth: 20 }],
      posts,
    });
    expect(stats.postsPublished).toBe(4);
    expect(stats.postsWithMetrics).toBe(3);
    expect(stats.lowest[0].engagementRatePct).toBe(2);
    expect(stats.bestSlots[0].when).toMatch(/^Monday 09:00/);
    expect(stats.followerGrowth[0]).toEqual({ account: "Acme", platform: "facebook_page", growth: 20, followers: 120 });
  });

  it("requires exactly three ideas with known platforms", () => {
    const idea = { title: "t", brief: "b", platforms: ["facebook"], goal: null };
    const base = { headline: "h", worked: ["w"], didnt: ["d"] };
    expect(insightSchema.safeParse({ ...base, ideas: [idea, idea, idea] }).success).toBe(true);
    expect(insightSchema.safeParse({ ...base, ideas: [idea, idea] }).success).toBe(false);
    expect(insightSchema.safeParse({ ...base, ideas: [idea, idea, { ...idea, platforms: ["myspace"] }] }).success).toBe(false);
  });
});

describe("deleted posts", () => {
  it("treats Meta's object-does-not-exist error as the post being gone", async () => {
    const gone = new PublishError("Object with ID does not exist", "content", 100, 33);
    expect(skippable(gone)).toBe(false);
    const { client } = graph({ "/dead": gone, "/dead/insights": gone });
    await expect(facebookPostMetrics(client, "dead")).rejects.toBe(gone);
  });
});
