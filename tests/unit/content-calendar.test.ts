import { describe, expect, it } from "vitest";
import { approvalRequired, canSelfApprove, normalizePolicy, scheduleDecision } from "@/lib/content/approval";
import { isValidTimezone, moveToDay, parseLocalInput, toLocalInput, zonedDateKey, zonedToUtc } from "@/lib/content/timezone";
import { PublishError, classifyMetaError, graphClient, type FetchLike } from "@/lib/social/publish/meta-http";
import { publishToFacebook } from "@/lib/social/publish/facebook";
import { publishToInstagram } from "@/lib/social/publish/instagram";
import { igAspectIssue, unreachableMediaUrl } from "@/lib/social/publish/media";

const env = { META_APP_ID: "app", META_APP_SECRET: "secret" };

describe("timezone", () => {
  it("converts wall-clock time in a zone to UTC", () => {
    expect(zonedToUtc(2026, 6, 1, 9, 0, "Africa/Lagos").toISOString()).toBe("2026-06-01T08:00:00.000Z");
    expect(zonedToUtc(2026, 1, 15, 9, 30, "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z");
    expect(zonedToUtc(2026, 7, 15, 9, 30, "America/New_York").toISOString()).toBe("2026-07-15T13:30:00.000Z");
  });

  it("round-trips datetime-local input", () => {
    const d = parseLocalInput("2026-03-29T10:15", "Europe/London")!;
    expect(d.toISOString()).toBe("2026-03-29T09:15:00.000Z"); // BST started that morning
    expect(toLocalInput(d, "Europe/London")).toBe("2026-03-29T10:15");
    expect(parseLocalInput("nonsense", "UTC")).toBeNull();
  });

  it("keeps the time of day when moving across a DST change", () => {
    const before = zonedToUtc(2026, 3, 27, 9, 0, "Europe/London"); // GMT
    const moved = moveToDay(before, "2026-03-30", "Europe/London"); // BST
    expect(toLocalInput(moved, "Europe/London")).toBe("2026-03-30T09:00");
  });

  it("uses the zone's date, not UTC's", () => {
    expect(zonedDateKey(new Date("2026-05-01T23:30:00Z"), "Africa/Lagos")).toBe("2026-05-02");
    expect(isValidTimezone("Africa/Lagos")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("approval policy", () => {
  it("auto needs approval only for teams", () => {
    expect(approvalRequired("auto", 1)).toBe(false);
    expect(approvalRequired("auto", 3)).toBe(true);
    expect(approvalRequired("none", 10)).toBe(false);
    expect(approvalRequired("always", 1)).toBe(true);
    expect(normalizePolicy("bogus")).toBe("auto");
  });

  it("decides what scheduling does", () => {
    const base = { policy: "auto" as const, teamSize: 4, postApproved: false };
    expect(scheduleDecision({ ...base, role: "member" })).toBe("needs_approval");
    expect(scheduleDecision({ ...base, role: "admin" })).toBe("approve_and_schedule");
    expect(scheduleDecision({ ...base, role: "member", postApproved: true })).toBe("schedule");
    expect(scheduleDecision({ ...base, policy: "always", role: "admin" })).toBe("needs_approval");
    expect(scheduleDecision({ ...base, teamSize: 1, role: "member" })).toBe("schedule");
    expect(canSelfApprove("admins_approve", "admin")).toBe(true);
    expect(canSelfApprove("admins_approve", "member")).toBe(false);
  });
});

describe("classifyMetaError", () => {
  const err = (code: number, extra: Record<string, unknown> = {}) => ({ error: { message: "m", code, ...extra } });
  it("sorts errors into auth, retry and content", () => {
    expect(classifyMetaError(400, err(190)).kind).toBe("auth");
    expect(classifyMetaError(403, err(200)).kind).toBe("auth");
    expect(classifyMetaError(400, err(4)).kind).toBe("retry");
    expect(classifyMetaError(400, err(80001)).kind).toBe("retry");
    expect(classifyMetaError(400, err(9007, { error_subcode: 2207027 })).kind).toBe("retry");
    expect(classifyMetaError(500, {}).kind).toBe("retry");
    expect(classifyMetaError(400, err(100, { error_user_msg: "Image too small" }))).toMatchObject({ kind: "content", message: "Image too small" });
  });
});

/** A fake Graph API: records calls and answers from a route table. */
function fakeGraph(routes: Record<string, unknown | ((params: URLSearchParams) => unknown)>) {
  const calls: { method: string; path: string; params: URLSearchParams }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v[\d.]+/, "");
    const params = init?.method === "POST" ? new URLSearchParams(String(init.body)) : u.searchParams;
    calls.push({ method: init?.method ?? "GET", path, params });
    const key = `${init?.method ?? "GET"} ${path}`;
    const r = routes[key];
    if (r === undefined) return new Response(JSON.stringify({ error: { message: `no route ${key}`, code: 100 } }), { status: 400 });
    const body = typeof r === "function" ? (r as (p: URLSearchParams) => unknown)(params) : r;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, client: graphClient("tok", env, fetchImpl) };
}

const img = (n: number) => ({ kind: "image", url: `https://cdn.example.com/${n}.jpg`, mimeType: "image/jpeg", altText: null });

describe("publishToFacebook", () => {
  it("posts text with a link to the feed", async () => {
    const { calls, client } = fakeGraph({ "POST /p1/feed": { id: "p1_9" }, "GET /p1_9": { permalink_url: "https://facebook.com/p1/posts/9" } });
    const r = await publishToFacebook(client, { externalId: "p1", text: "Hi", linkUrl: "https://acme.test/x", media: [] });
    expect(r).toEqual({ externalPostId: "p1_9", permalink: "https://facebook.com/p1/posts/9" });
    expect(calls[0].params.get("message")).toBe("Hi");
    expect(calls[0].params.get("link")).toBe("https://acme.test/x");
    expect(calls[0].params.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uploads several photos unpublished, then attaches them", async () => {
    let n = 0;
    const { calls, client } = fakeGraph({ "POST /p1/photos": () => ({ id: `ph${++n}` }), "POST /p1/feed": { id: "p1_10" }, "GET /p1_10": {} });
    await publishToFacebook(client, { externalId: "p1", text: "Two", linkUrl: null, media: [img(1), img(2)] });
    expect(calls.filter((c) => c.path === "/p1/photos").every((c) => c.params.get("published") === "false")).toBe(true);
    const feed = calls.find((c) => c.path === "/p1/feed")!;
    expect(feed.params.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "ph2" }));
  });

  it("surfaces Meta's reason as a content error", async () => {
    const { client } = fakeGraph({});
    await expect(publishToFacebook(client, { externalId: "p1", text: "x", linkUrl: null, media: [] })).rejects.toMatchObject({ kind: "content" });
  });
});

describe("publishToInstagram", () => {
  const noSleep = { sleep: async () => {}, maxWaitMs: 60_000 };

  it("creates a container, waits, then publishes", async () => {
    const saved: (string | null)[] = [];
    let polls = 0;
    const { calls, client } = fakeGraph({
      "GET /ig1/content_publishing_limit": { data: [{ quota_usage: 3, config: { quota_total: 25 } }] },
      "POST /ig1/media": { id: "c1" },
      "GET /c1": () => ({ status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" }),
      "POST /ig1/media_publish": { id: "m1" },
      "GET /m1": { permalink: "https://instagram.com/p/abc" },
    });
    const r = await publishToInstagram(client, { externalId: "ig1", text: "Caption", linkUrl: null, media: [img(1)] }, { ...noSleep, onContainer: async (id) => void saved.push(id) });
    expect(r).toEqual({ externalPostId: "m1", permalink: "https://instagram.com/p/abc" });
    expect(saved).toEqual(["c1"]);
    expect(calls.find((c) => c.path === "/ig1/media")!.params.get("caption")).toBe("Caption");
    expect(calls.find((c) => c.path === "/ig1/media_publish")!.params.get("creation_id")).toBe("c1");
  });

  it("builds carousels from child containers", async () => {
    let n = 0;
    const { calls, client } = fakeGraph({
      "GET /ig1/content_publishing_limit": { data: [] },
      "POST /ig1/media": (p: URLSearchParams) => ({ id: p.get("media_type") === "CAROUSEL" ? "car" : `ch${++n}` }),
      "GET /ch1": { status_code: "FINISHED" },
      "GET /ch2": { status_code: "FINISHED" },
      "GET /car": { status_code: "FINISHED" },
      "POST /ig1/media_publish": { id: "m2" },
      "GET /m2": {},
    });
    await publishToInstagram(client, { externalId: "ig1", text: "Many", linkUrl: null, media: [img(1), img(2)] }, noSleep);
    const parent = calls.find((c) => c.params.get("media_type") === "CAROUSEL")!;
    expect(parent.params.get("children")).toBe("ch1,ch2");
    expect(calls.filter((c) => c.params.get("is_carousel_item") === "true")).toHaveLength(2);
  });

  it("reuses a saved container and doesn't re-upload", async () => {
    const { calls, client } = fakeGraph({ "GET /c9": { status_code: "FINISHED" }, "POST /ig1/media_publish": { id: "m3" }, "GET /m3": {} });
    await publishToInstagram(client, { externalId: "ig1", text: "x", linkUrl: null, media: [img(1)], containerId: "c9" }, noSleep);
    expect(calls.some((c) => c.path === "/ig1/media")).toBe(false);
  });

  it("hands back to the queue at the publishing limit, and refuses posts without media", async () => {
    const { client } = fakeGraph({ "GET /ig1/content_publishing_limit": { data: [{ quota_usage: 25, config: { quota_total: 25 } }] } });
    await expect(publishToInstagram(client, { externalId: "ig1", text: "x", linkUrl: null, media: [img(1)] }, noSleep)).rejects.toMatchObject({ kind: "retry" });
    await expect(publishToInstagram(client, { externalId: "ig1", text: "x", linkUrl: null, media: [] })).rejects.toBeInstanceOf(PublishError);
  });

  it("clears a container Instagram couldn't process", async () => {
    const saved: (string | null)[] = [];
    const { client } = fakeGraph({ "GET /c5": { status_code: "ERROR", status: "bad format" } });
    await expect(
      publishToInstagram(client, { externalId: "ig1", text: "x", linkUrl: null, media: [img(1)], containerId: "c5" }, { ...noSleep, onContainer: async (id) => void saved.push(id) })
    ).rejects.toMatchObject({ kind: "content" });
    expect(saved).toEqual([null]);
  });
});

describe("media checks", () => {
  it("checks Instagram aspect ratios and unreachable URLs", () => {
    expect(igAspectIssue({ kind: "image", width: 1080, height: 1350 })).toBeNull();
    expect(igAspectIssue({ kind: "image", width: 1080, height: 1920 })).toMatch(/taller/);
    expect(igAspectIssue({ kind: "image", width: 3000, height: 1000 })).toMatch(/wider/);
    expect(unreachableMediaUrl("http://localhost:3000/api/media/files/a.jpg")).toBe(true);
    expect(unreachableMediaUrl("https://cdn.example.com/a.jpg")).toBe(false);
  });
});
