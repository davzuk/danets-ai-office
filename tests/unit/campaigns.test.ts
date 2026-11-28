import { describe, expect, it } from "vitest";
import {
  acceptsUtmMatches,
  buildMatchIndex,
  createCampaignSchema,
  endedAtFor,
  matchCampaign,
  normalizeAliases,
  uniqueSlug,
  updateCampaignSchema,
  type MatchableCampaign,
} from "@/lib/campaigns/rules";
import { touchData } from "@/lib/attribution";

const DAY = 86_400_000;
const now = new Date("2027-03-01T12:00:00Z");
const c = (over: Partial<MatchableCampaign>): MatchableCampaign => ({ id: "c1", slug: "spring-sale", aliases: [], status: "active", endedAt: null, ...over });

describe("campaign aliases and slugs", () => {
  it("slugifies, de-duplicates and drops the slug itself", () => {
    expect(normalizeAliases(["Spring Sale!", "spring-sale-26", "Spring Sale 26", "", 3, "Ünïcode Deal"], "spring-sale")).toEqual(["spring-sale-26", "unicode-deal"]);
    expect(normalizeAliases("nope", "x")).toEqual([]);
  });

  it("picks a free slug", () => {
    expect(uniqueSlug("Spring Sale", new Set())).toBe("spring-sale");
    expect(uniqueSlug("Spring Sale", new Set(["spring-sale", "spring-sale-2"]))).toBe("spring-sale-3");
    expect(uniqueSlug("!!!", new Set())).toBe("campaign");
  });
});

describe("matching utm_campaign to campaigns", () => {
  it("matches the slug and aliases after slugifying the incoming value", () => {
    const index = buildMatchIndex([c({ aliases: ["spring-sale-fb"] }), c({ id: "c2", slug: "summer" })], now);
    expect(matchCampaign(index, "Spring Sale")).toBe("c1");
    expect(matchCampaign(index, "spring_sale_fb")).toBe("c1");
    expect(matchCampaign(index, "SUMMER")).toBe("c2");
    expect(matchCampaign(index, "winter")).toBeNull();
    expect(matchCampaign(index, null)).toBeNull();
  });

  it("lets a slug win over another campaign's alias", () => {
    const index = buildMatchIndex([c({ id: "a", slug: "x", aliases: ["promo"] }), c({ id: "b", slug: "promo" })], now);
    expect(matchCampaign(index, "promo")).toBe("b");
  });

  it("stops matching archived campaigns, and ended ones after 30 days", () => {
    expect(acceptsUtmMatches(c({ status: "archived" }), now)).toBe(false);
    expect(acceptsUtmMatches(c({ status: "ended", endedAt: new Date(now.getTime() - 10 * DAY) }), now)).toBe(true);
    expect(acceptsUtmMatches(c({ status: "ended", endedAt: new Date(now.getTime() - 31 * DAY) }), now)).toBe(false);
    expect(acceptsUtmMatches(c({ status: "paused" }), now)).toBe(true);
    expect(acceptsUtmMatches(c({ status: "draft" }), now)).toBe(true);
    const index = buildMatchIndex([c({ status: "ended", endedAt: new Date(now.getTime() - 40 * DAY) })], now);
    expect(matchCampaign(index, "spring-sale")).toBeNull();
  });

  it("records when a campaign ended and keeps the date while archived", () => {
    const ended = new Date("2027-02-01T00:00:00Z");
    expect(endedAtFor("ended", { status: "active", endedAt: null }, now)).toEqual(now);
    expect(endedAtFor("ended", { status: "ended", endedAt: ended }, now)).toEqual(ended);
    expect(endedAtFor("archived", { status: "ended", endedAt: ended }, now)).toEqual(ended);
    expect(endedAtFor("active", { status: "ended", endedAt: ended }, now)).toBeNull();
  });
});

describe("campaign input", () => {
  it("validates dates, budget and name", () => {
    expect(createCampaignSchema.safeParse({ name: "A" }).success).toBe(false);
    const ok = createCampaignSchema.parse({ name: "Spring", budget: "250.555", startsAt: "2027-03-01", endsAt: "" });
    expect(ok.budget).toBe(250.56);
    expect(ok.startsAt).toEqual(new Date("2027-03-01"));
    expect(ok.endsAt).toBeNull();
    expect(createCampaignSchema.safeParse({ name: "Spring", startsAt: "2027-03-10", endsAt: "2027-03-01" }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ name: "Spring", budget: -1 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ name: "Spring", status: "ended" }).success).toBe(false);
    expect(updateCampaignSchema.safeParse({ status: "archived" }).success).toBe(true);
  });
});

describe("touch data", () => {
  it("carries an explicit campaign id and defaults to none", () => {
    expect(touchData({ businessId: "b", kind: "form_submit", campaignId: "c9" }).campaignId).toBe("c9");
    expect(touchData({ businessId: "b", kind: "visit", touch: { campaign: "spring" } }).campaignId).toBeNull();
  });
});
