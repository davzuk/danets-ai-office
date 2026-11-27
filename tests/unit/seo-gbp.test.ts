import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── In-memory stand-in for the tables review requests touch ───────────

const mem = vi.hoisted(() => ({
  modules: new Set<string>(["seo"]),
  locations: [] as Record<string, unknown>[],
  bookings: [] as Record<string, unknown>[],
  leads: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  requests: [] as Record<string, unknown>[],
  whatsapp: null as Record<string, unknown> | null,
  emails: [] as { to: string; subject: string; html: string }[],
  whatsappSent: [] as { to: string; text: string }[],
  emailOk: true,
}));

vi.mock("@/lib/db", () => {
  const byId = (rows: Record<string, unknown>[], where: Record<string, unknown>) =>
    rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
  let n = 0;
  return {
    db: {
      businessLocation: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          mem.locations.find((l) => l.businessId === where.businessId && l.status === where.status && (!where.id || l.id === where.id)) ?? null,
      },
      booking: { findFirst: async ({ where }: { where: Record<string, unknown> }) => byId(mem.bookings, where) },
      lead: { findFirst: async ({ where }: { where: Record<string, unknown> }) => byId(mem.leads, where) },
      contact: { findUnique: async ({ where }: { where: { id: string } }) => byId(mem.contacts, { id: where.id }) },
      business: { findUnique: async () => ({ name: "Acme Plumbing" }) },
      whatsAppIntegration: { findFirst: async () => mem.whatsapp },
      reviewRequest: {
        findFirst: async ({ where }: { where: { businessId: string; sentAt: { gte: Date }; OR: Record<string, unknown>[] } }) =>
          mem.requests.find(
            (r) =>
              r.businessId === where.businessId &&
              (r.sentAt as Date) >= where.sentAt.gte &&
              where.OR.some((o) => Object.entries(o).every(([k, v]) => r[k] === v))
          ) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `rr${++n}`, ...data };
          mem.requests.push(row);
          return row;
        },
        delete: async ({ where }: { where: { id: string } }) => {
          mem.requests = mem.requests.filter((r) => r.id !== where.id);
        },
      },
    },
  };
});
vi.mock("@/lib/module-access", () => ({ isModuleEnabled: async (_b: string, m: string) => mem.modules.has(m) }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (m: { to: string; subject: string; html: string }) => {
    mem.emails.push(m);
    return { success: mem.emailOk };
  },
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: async (_b: string, to: string, text: string) => {
    mem.whatsappSent.push({ to, text });
    return { success: true };
  },
}));
// reviews.ts pulls these in; the pure helpers tested here never call them.
vi.mock("@/lib/automation", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/automation")>()), fireTrigger: vi.fn() }));
vi.mock("@/lib/llm", () => ({ aiStructured: vi.fn(), logUsage: vi.fn(), AiRefusalError: class extends Error {} }));
vi.mock("@/lib/brand", () => ({ getBrandContext: vi.fn(), getBrandProfileRow: vi.fn() }));
vi.mock("@/lib/activity", () => ({ createNotification: vi.fn(), logActivity: vi.fn() }));

import { localPostBody, originalComment, performanceQuery, replyTooLong, toDailyValues, toReview, toReviewPage, v4LocationPath } from "@/lib/seo/gbp";
import { autoReplyEligible, autoThanks, replyDecision, replyPrompt, reviewRowUpdate } from "@/lib/seo/reviews";
import { isGoogleUrl, refusedConsent, reviewRequestText, sendReviewRequest } from "@/lib/seo/review-requests";
import { dailySeries, groupTotals, metricsWindow } from "@/lib/seo/gbp-metrics";
import { publishErrorFrom, toLocalPost } from "@/lib/social/publish/google-business";
import { PublishError } from "@/lib/social/publish/meta-http";
import { OAuthGrantError, OAuthProviderError } from "@/lib/connections/types";
import { triggerConfigMatches as realMatches } from "@/lib/automation";

// ─── Google's response shapes (recorded from the v4 / Performance API docs) ──

const RAW_REVIEW = {
  name: "accounts/111/locations/222/reviews/AbC-xyz_123",
  reviewId: "AbC-xyz_123",
  reviewer: { displayName: "Jane Smith", profilePhotoUrl: "https://lh3.googleusercontent.com/a/photo" },
  starRating: "FOUR",
  comment: "Quick and tidy work. (Translated by Google) ignore\n\n(Original)\nRápido y limpio.",
  createTime: "2026-11-01T10:00:00.123Z",
  updateTime: "2026-11-02T09:30:00Z",
  reviewReply: { comment: "Thanks Jane!", updateTime: "2026-11-02T12:00:00Z", reviewReplyState: "APPROVED" },
};

describe("Business Profile review mapping", () => {
  it("maps a review, keeping the original text of a translated comment", () => {
    const r = toReview(RAW_REVIEW)!;
    expect(r.reviewName).toBe(RAW_REVIEW.name);
    expect(r.reviewerName).toBe("Jane Smith");
    expect(r.starRating).toBe(4);
    expect(r.comment).toBe("Rápido y limpio.");
    expect(r.updatedAt.toISOString()).toBe("2026-11-02T09:30:00.000Z");
    expect(r.reply).toEqual({ text: "Thanks Jane!", at: new Date("2026-11-02T12:00:00Z"), state: "APPROVED" });
  });

  it("hides an anonymous reviewer's name and photo, and treats a rating-only review as no comment", () => {
    const r = toReview({ ...RAW_REVIEW, reviewer: { displayName: "A Google user", isAnonymous: true }, comment: "  ", reviewReply: undefined })!;
    expect(r.reviewerName).toBeNull();
    expect(r.reviewerPhoto).toBeNull();
    expect(r.anonymous).toBe(true);
    expect(r.comment).toBeNull();
    expect(r.reply).toBeNull();
  });

  it("drops reviews with no name or a bad date, and reads page totals", () => {
    const page = toReviewPage({ reviews: [RAW_REVIEW, { createTime: "2026-01-01T00:00:00Z" }, { name: "x", createTime: "nope" }], averageRating: 4.6, totalReviewCount: 87, nextPageToken: "tok" });
    expect(page.reviews).toHaveLength(1);
    expect(page).toMatchObject({ averageRating: 4.6, totalReviewCount: 87, nextPageToken: "tok" });
    expect(toReviewPage(null)).toEqual({ reviews: [], averageRating: null, totalReviewCount: null, nextPageToken: null });
  });

  it("keeps an untranslated comment as it is", () => {
    expect(originalComment("Great service")).toBe("Great service");
    expect(originalComment(undefined)).toBeNull();
  });

  it("refuses location names that could change the request path", () => {
    expect(v4LocationPath("accounts/111", "locations/222")).toBe("accounts/111/locations/222");
    expect(() => v4LocationPath("accounts/../x", "locations/222")).toThrow();
    expect(() => v4LocationPath("accounts/111", "locations/2?x=1")).toThrow();
  });

  it("measures the reply limit in bytes, not characters", () => {
    expect(replyTooLong("a".repeat(4096))).toBe(false);
    expect(replyTooLong("é".repeat(2049))).toBe(true);
  });
});

describe("syncing a review onto our row", () => {
  const data = toReview(RAW_REVIEW)!;
  const noReply = { ...data, reply: null };

  it("records a reply found on Google as posted", () => {
    expect(reviewRowUpdate(null, data)).toMatchObject({ replyText: "Thanks Jane!", replyState: "APPROVED", replyStatus: "posted", replyError: null });
  });

  it("leaves a draft or a reply waiting for approval alone", () => {
    for (const replyStatus of ["draft", "pending_approval"]) {
      const u = reviewRowUpdate({ replyStatus, replyText: null }, data);
      expect(u.replyText).toBe("Thanks Jane!");
      expect(u).not.toHaveProperty("replyStatus");
    }
  });

  it("notices a reply that was deleted on Google", () => {
    expect(reviewRowUpdate({ replyStatus: "posted", replyText: "Old" }, noReply)).toMatchObject({ replyText: null, replyStatus: "none" });
    expect(reviewRowUpdate({ replyStatus: "draft", replyText: null }, noReply)).not.toHaveProperty("replyStatus");
  });
});

describe("auto-replies to rating-only reviews", () => {
  it("only fits 4-5 stars with no text and no reply", () => {
    expect(autoReplyEligible({ starRating: 5, comment: null, replyText: null })).toBe(true);
    expect(autoReplyEligible({ starRating: 4, comment: "  ", replyText: null })).toBe(true);
    expect(autoReplyEligible({ starRating: 3, comment: null, replyText: null })).toBe(false);
    expect(autoReplyEligible({ starRating: 5, comment: "Lovely", replyText: null })).toBe(false);
    expect(autoReplyEligible({ starRating: 5, comment: null, replyText: "Thanks" })).toBe(false);
  });

  it("picks a stable thank-you that uses the first name", () => {
    expect(autoThanks("rev1", "Jane Smith")).toBe(autoThanks("rev1", "Jane Smith"));
    expect(autoThanks("rev1", "Jane Smith")).toContain(", Jane");
    expect(autoThanks("rev1", null)).not.toContain("{name}");
    expect(new Set(["a", "b", "c", "d", "e", "f"].map((id) => autoThanks(id, null))).size).toBeGreaterThan(1);
  });
});

describe("reply approval", () => {
  it("follows the content approval policy", () => {
    expect(replyDecision("auto", 1, "member")).toBe("post");
    expect(replyDecision("auto", 3, "member")).toBe("needs_approval");
    expect(replyDecision("auto", 3, "admin")).toBe("post");
    expect(replyDecision("none", 5, "member")).toBe("post");
    expect(replyDecision("always", 1, "admin")).toBe("needs_approval");
    expect(replyDecision(null, 1, "member")).toBe("post");
  });
});

describe("reply drafting prompt", () => {
  const base = { businessName: "Acme", brand: "Warm and plain.", phone: "020 7946 0000", email: "hi@acme.test", locationTitle: "Acme Leeds", reviewerName: "Jane", comment: "Late again.", dontPhrases: [] as string[] };

  it("handles a low rating calmly and offers the contact details", () => {
    const { system, user } = replyPrompt({ ...base, rating: 1 });
    expect(system).toMatch(/low rating/);
    expect(system).toContain("020 7946 0000");
    expect(system).toMatch(/Never promise refunds/);
    expect(user).toContain("1 of 5 stars");
    expect(user).toContain("Late again.");
  });

  it("uses the positive rules for 4-5 stars and lists banned phrases", () => {
    const { system, user } = replyPrompt({ ...base, rating: 5, comment: null, dontPhrases: ["no worries"] });
    expect(system).toMatch(/positive rating/);
    expect(system).not.toMatch(/low rating/);
    expect(system).toContain('"no worries"');
    expect(user).toContain("(no text, rating only)");
  });

  it("covers a mixed rating", () => {
    expect(replyPrompt({ ...base, rating: 3 }).system).toMatch(/mixed rating/);
  });
});

describe("local posts", () => {
  const input = { text: "  Winter boiler checks are open.  ", media: [], linkUrl: null, externalId: "accounts/1/locations/2" } as never;

  it("builds a What's new post with a button only when there's a link", () => {
    const p = toLocalPost(input);
    expect(p).toMatchObject({ summary: "Winter boiler checks are open.", actionType: "LEARN_MORE", imageUrl: null });
    expect(localPostBody(p)).toEqual({ languageCode: "en", summary: "Winter boiler checks are open.", topicType: "STANDARD" });

    const booked = toLocalPost({ ...(input as object), linkUrl: "https://acme.test/book/boiler", media: [{ kind: "image", url: "https://cdn.test/a.jpg" }] } as never);
    expect(localPostBody(booked)).toMatchObject({
      callToAction: { actionType: "BOOK", url: "https://acme.test/book/boiler" },
      media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.test/a.jpg" }],
    });
  });

  it("refuses video, several photos, empty and over-long posts as content errors", () => {
    const bad = [
      { media: [{ kind: "video", url: "v" }] },
      { media: [{ kind: "image", url: "a" }, { kind: "image", url: "b" }] },
      { text: "   " },
      { text: "x".repeat(1501) },
    ];
    for (const b of bad) {
      try {
        toLocalPost({ ...(input as object), ...b } as never);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(PublishError);
        expect((e as PublishError).kind).toBe("content");
      }
    }
  });

  it("sorts Google failures into auth, content and retry", () => {
    expect(publishErrorFrom(new OAuthGrantError("revoked", "invalid_grant")).kind).toBe("auth");
    expect(publishErrorFrom(new OAuthProviderError("nope", 403)).kind).toBe("auth");
    expect(publishErrorFrom(new OAuthProviderError("bad", 400)).kind).toBe("content");
    expect(publishErrorFrom(new OAuthProviderError("busy", 503)).kind).toBe("retry");
    expect(publishErrorFrom(new Error("socket hang up")).kind).toBe("retry");
  });
});

describe("Business Profile performance", () => {
  it("flattens the time series, treating a missing value as 0 and skipping unknown metrics", () => {
    const rows = toDailyValues({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: "3" }, { date: { year: 2026, month: 11, day: 2 } }] } },
            { dailyMetric: "BUSINESS_CONVERSATIONS", timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: "9" }] } },
          ],
        },
      ],
    });
    expect(rows).toEqual([
      { date: "2026-11-01", metric: "CALL_CLICKS", value: 3 },
      { date: "2026-11-02", metric: "CALL_CLICKS", value: 0 },
    ]);
  });

  it("asks for every metric over the date range", () => {
    const q = performanceQuery("2026-05-01", "2026-11-26");
    expect(q.getAll("dailyMetrics")).toHaveLength(8);
    expect(q.get("dailyRange.start_date.month")).toBe("5");
    expect(q.get("dailyRange.end_date.day")).toBe("26");
  });

  it("backfills 180 days first, then re-reads the last week", () => {
    const now = new Date("2026-11-27T08:00:00Z");
    expect(metricsWindow(null, now)).toEqual({ from: "2026-05-31", to: "2026-11-26" });
    expect(metricsWindow("2026-11-25", now)).toEqual({ from: "2026-11-18", to: "2026-11-26" });
  });

  it("groups metrics into views and actions, with every day present", () => {
    const rows = [
      { date: "2026-11-01", metric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", value: 10 },
      { date: "2026-11-01", metric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", value: 5 },
      { date: "2026-11-03", metric: "WEBSITE_CLICKS", value: 2 },
      { date: "2026-11-03", metric: "MESSAGING_CLICKS", value: 1 },
    ];
    expect(groupTotals(rows)).toEqual({ searchViews: 10, mapsViews: 5, calls: 0, websiteClicks: 2, directions: 0, messages: 1 });
    expect(dailySeries(rows, "2026-11-01", "2026-11-03")).toEqual([
      { date: "2026-11-01", views: 15, actions: 0 },
      { date: "2026-11-02", views: 0, actions: 0 },
      { date: "2026-11-03", views: 0, actions: 3 },
    ]);
  });
});

describe("automation trigger filters", () => {
  it("matches a lead status change only to the chosen status", () => {
    expect(realMatches("lead_status_changed", { leadStatus: "won" }, { businessId: "b", status: "won" })).toBe(true);
    expect(realMatches("lead_status_changed", { leadStatus: "won" }, { businessId: "b", status: "lost" })).toBe(false);
    expect(realMatches("lead_status_changed", {}, { businessId: "b", status: "lost" })).toBe(true);
  });

  it("filters new reviews by rating", () => {
    const ctx = (rating: number) => ({ businessId: "b", rating });
    expect(realMatches("review_received", {}, ctx(1))).toBe(true);
    expect(realMatches("review_received", { maxRating: 2 }, ctx(2))).toBe(true);
    expect(realMatches("review_received", { maxRating: 2 }, ctx(3))).toBe(false);
    expect(realMatches("review_received", { minRating: 4 }, ctx(3))).toBe(false);
    expect(realMatches("review_received", { minRating: 4, maxRating: 5 }, ctx(5))).toBe(true);
  });
});

// ─── Review requests ───────────────────────────────────────────────────

describe("review requests", () => {
  const NOW = new Date("2026-11-27T12:00:00Z");
  beforeEach(() => {
    mem.modules = new Set(["seo"]);
    mem.locations = [{ id: "loc1", businessId: "b1", status: "active", title: "Acme Leeds", reviewUri: "https://search.google.com/local/writereview?placeid=abc", createdAt: NOW }];
    mem.bookings = [{ id: "bk1", businessId: "b1", name: "Sam Jones", email: "Sam@Example.com", phone: "+447700900123", contactId: "c1", leadId: "l1" }];
    mem.leads = [{ id: "l1", businessId: "b1", name: "Sam Jones", email: "sam@example.com", phone: null, contactId: "c1" }];
    mem.contacts = [{ id: "c1", consent: null }];
    mem.requests = [];
    mem.whatsapp = null;
    mem.emails = [];
    mem.whatsappSent = [];
    mem.emailOk = true;
  });

  it("emails the same Google link to everyone, with a tracked short link", async () => {
    const r = await sendReviewRequest("b1", { bookingId: "bk1", workflowId: "wf1" }, {}, NOW);
    expect(r).toMatchObject({ sent: true, to: "sam@example.com", channel: "email" });
    expect(mem.requests).toHaveLength(1);
    expect(mem.requests[0]).toMatchObject({ locationId: "loc1", contactId: "c1", bookingId: "bk1", workflowId: "wf1" });
    const token = mem.requests[0].token as string;
    expect(mem.emails[0].html).toContain(`/r/${token}`);
    // No review gating: there's no "were you happy?" step or rating choice.
    expect(mem.emails[0].html).not.toMatch(/unhappy|not happy|feedback form/i);
  });

  it("asks each person at most once every 90 days", async () => {
    await sendReviewRequest("b1", { leadId: "l1" }, {}, NOW);
    const again = await sendReviewRequest("b1", { bookingId: "bk1" }, {}, new Date(NOW.getTime() + 30 * 86_400_000));
    expect(again).toEqual({ sent: false, reason: "cooldown" });
    const later = await sendReviewRequest("b1", { bookingId: "bk1" }, {}, new Date(NOW.getTime() + 91 * 86_400_000));
    expect(later.sent).toBe(true);
  });

  it("respects refused consent for the channel", async () => {
    mem.contacts = [{ id: "c1", consent: { marketingEmail: { granted: false } } }];
    expect(await sendReviewRequest("b1", { leadId: "l1" }, {}, NOW)).toEqual({ sent: false, reason: "no_consent" });
    expect(refusedConsent({ whatsapp: { granted: false } }, "email")).toBe(false);
    expect(refusedConsent({ whatsapp: { granted: false } }, "whatsapp")).toBe(true);
    expect(refusedConsent(null, "email")).toBe(false);
  });

  it("frees the cooldown when sending fails", async () => {
    mem.emailOk = false;
    expect(await sendReviewRequest("b1", { leadId: "l1" }, {}, NOW)).toEqual({ sent: false, reason: "send_failed" });
    expect(mem.requests).toHaveLength(0);
  });

  it("needs the SEO module, a location with a review link and a working WhatsApp", async () => {
    mem.modules = new Set();
    expect(await sendReviewRequest("b1", { leadId: "l1" }, {}, NOW)).toEqual({ sent: false, reason: "module_disabled" });
    mem.modules = new Set(["seo"]);
    mem.locations[0].reviewUri = null;
    expect(await sendReviewRequest("b1", { leadId: "l1" }, {}, NOW)).toEqual({ sent: false, reason: "no_review_link" });
    mem.locations[0].reviewUri = "https://search.google.com/local/writereview?placeid=abc";
    expect(await sendReviewRequest("b1", { bookingId: "bk1" }, { channel: "whatsapp" }, NOW)).toEqual({ sent: false, reason: "whatsapp_unavailable" });
    mem.modules.add("whatsapp");
    mem.whatsapp = { provider: "twilio", status: "active" };
    const r = await sendReviewRequest("b1", { bookingId: "bk1" }, { channel: "whatsapp", message: "Hi {name}, how did we do?" }, NOW);
    expect(r.sent).toBe(true);
    expect(mem.whatsappSent[0].text).toMatch(/^Hi Sam, how did we do\?\n\nhttp.*\/r\//);
  });

  it("only redirects to Google's own pages", () => {
    expect(isGoogleUrl("https://search.google.com/local/writereview?placeid=abc")).toBe(true);
    expect(isGoogleUrl("https://g.page/r/abc/review")).toBe(true);
    expect(isGoogleUrl("https://maps.google.com/maps?cid=1")).toBe(true);
    expect(isGoogleUrl("https://google.com.evil.test/x")).toBe(false);
    expect(isGoogleUrl("https://evilgoogle.com/x")).toBe(false);
    expect(isGoogleUrl("http://search.google.com/x")).toBe(false);
    expect(isGoogleUrl("javascript:alert(1)")).toBe(false);
  });

  it("writes a default message when the workflow has none", () => {
    const t = reviewRequestText({ name: "Sam Jones", businessName: "Acme", locationTitle: "Leeds", link: "https://app.test/r/x" });
    expect(t.intro).toMatch(/^Hi Sam, thanks for choosing Acme/);
    expect(t.whatsapp.endsWith("https://app.test/r/x")).toBe(true);
  });
});
