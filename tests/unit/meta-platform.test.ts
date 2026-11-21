import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { decryptApiKey, isEncryptedPayload } = await import("@/lib/crypto");
const { metaAssets } = await import("@/lib/connections/providers/meta");
const { planAssetSync } = await import("@/lib/social/accounts");
const { metaEventDedupeKey, routeMetaWebhook } = await import("@/lib/social/meta-webhook-routing");
const { parseMetaSignedRequest, signMetaRequest } = await import("@/lib/social/meta-signed-request");
const { eventEnabled } = await import("@/lib/jobs/handlers/meta-webhook");

describe("metaAssets", () => {
  const assets = metaAssets([
    {
      id: "p1",
      name: "Acme Dental",
      access_token: "PAGE-TOKEN-1",
      tasks: ["MANAGE"],
      picture: { data: { url: "https://cdn/p1.jpg" } },
      instagram_business_account: { id: "ig1", username: "acmedental", profile_picture_url: "https://cdn/ig1.jpg" },
    },
    { id: "p2", name: "Acme Ortho" },
  ]);

  it("maps each Page and its linked Instagram account", () => {
    expect(assets.map((a) => [a.platform, a.externalId, a.parentExternalId ?? null])).toEqual([
      ["facebook_page", "p1", null],
      ["instagram", "ig1", "p1"],
      ["facebook_page", "p2", null],
    ]);
    expect(assets[1]).toMatchObject({ name: "acmedental", username: "acmedental", pictureUrl: "https://cdn/ig1.jpg" });
    expect(assets[0].pictureUrl).toBe("https://cdn/p1.jpg");
  });

  it("only ever carries page tokens encrypted", () => {
    expect(JSON.stringify(assets)).not.toContain("PAGE-TOKEN-1");
    expect(isEncryptedPayload(assets[0].accessToken)).toBe(true);
    expect(decryptApiKey(assets[0].accessToken)).toBe("PAGE-TOKEN-1");
    expect(decryptApiKey(assets[1].accessToken)).toBe("PAGE-TOKEN-1"); // IG uses the Page token
    expect(assets[2].accessToken).toBeNull();
  });
});

describe("planAssetSync", () => {
  const page = (externalId: string) => ({ platform: "facebook_page" as const, externalId, name: externalId });
  const row = (id: string, externalId: string, businessId = "b1", connectionId = "c1", status = "active") => ({
    id,
    businessId,
    connectionId,
    platform: "facebook_page",
    externalId,
    status,
  });

  it("upserts own and new assets, reports other tenants' as conflicts", () => {
    const plan = planAssetSync("b1", "c1", [page("p1"), page("p2"), page("p3")], [row("r1", "p1"), row("r2", "p2", "b2", "cX")]);
    expect(plan.upserts.map((a) => a.externalId)).toEqual(["p1", "p3"]);
    expect(plan.conflicts.map((a) => a.externalId)).toEqual(["p2"]);
    expect(plan.revokeIds).toEqual([]);
  });

  it("takes over an asset from another connection of the same business", () => {
    const plan = planAssetSync("b1", "c2", [page("p1")], [row("r1", "p1", "b1", "c1")]);
    expect(plan.upserts.map((a) => a.externalId)).toEqual(["p1"]);
    expect(plan.conflicts).toEqual([]);
  });

  it("revokes this connection's assets that are no longer granted", () => {
    const plan = planAssetSync("b1", "c1", [page("p1")], [row("r1", "p1"), row("r2", "p2"), row("r3", "p3", "b1", "c1", "revoked")]);
    expect(plan.revokeIds).toEqual(["r2"]);
  });

  it("ignores duplicate assets in one grant", () => {
    expect(planAssetSync("b1", "c1", [page("p1"), page("p1")], []).upserts).toHaveLength(1);
  });
});

describe("routeMetaWebhook", () => {
  it("routes Page leadgen, feed comments and Messenger messages", () => {
    const { events, ignored } = routeMetaWebhook({
      object: "page",
      entry: [
        {
          id: "p1",
          time: 1,
          changes: [
            { field: "leadgen", value: { leadgen_id: "L1", page_id: "p1", form_id: "F1", ad_id: "A1", created_time: 1700000000 } },
            { field: "feed", value: { item: "comment", verb: "add", comment_id: "C1", post_id: "P1", message: "Price?" } },
            { field: "feed", value: { item: "reaction", verb: "add" } },
          ],
          messaging: [
            { sender: { id: "u1" }, recipient: { id: "p1" }, timestamp: 5, message: { mid: "m1", text: "hi" } },
            { sender: { id: "p1" }, recipient: { id: "u1" }, timestamp: 6, message: { mid: "m2", text: "hello", is_echo: true } },
            { sender: { id: "u1" }, recipient: { id: "p1" }, timestamp: 7, read: { watermark: 6 } },
            { sender: { id: "u1" }, recipient: { id: "p1" }, timestamp: 8, postback: { payload: "GET_STARTED" } },
          ],
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["leadgen", "comment", "message", "message", "message"]);
    expect(events[0]).toMatchObject({ leadgenId: "L1", formId: "F1", adId: "A1", accountExternalId: "p1" });
    expect(events[1]).toMatchObject({ commentId: "C1", verb: "add", platform: "facebook_page" });
    expect(events[3]).toMatchObject({ mid: "m2", isEcho: true });
    expect(events[4]).toMatchObject({ mid: "pb:u1:8" });
    expect(ignored).toEqual(["page.feed:reaction", "page.messaging:read"]);
  });

  it("routes Instagram comments and DMs to the IG account", () => {
    const { events } = routeMetaWebhook({
      object: "instagram",
      entry: [
        {
          id: "ig1",
          changes: [{ field: "comments", value: { id: "IC1", text: "Love it", from: { id: "u9", username: "fan" }, media: { id: "M1" } } }],
          messaging: [{ sender: { id: "u9" }, recipient: { id: "ig1" }, timestamp: 9, message: { mid: "igm1", text: "hey" } }],
        },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.platform === "instagram" && e.accountExternalId === "ig1")).toBe(true);
  });

  it("ignores unknown objects and malformed entries", () => {
    expect(routeMetaWebhook({ object: "user", entry: [{ id: "x" }] })).toEqual({ events: [], ignored: ["object:user"] });
    expect(routeMetaWebhook({ object: "page", entry: [null, "x", { changes: [] }, { id: "p1", changes: [{ field: "leadgen", value: {} }] }] }).events).toEqual([]);
  });

  it("gives stable dedupe keys", () => {
    const { events } = routeMetaWebhook({
      object: "page",
      entry: [{ id: "p1", changes: [{ field: "leadgen", value: { leadgen_id: "L1" } }] }],
    });
    expect(metaEventDedupeKey(events[0])).toBe("meta-leadgen:L1");
  });

  it("respects the per-account toggles", () => {
    const lead = routeMetaWebhook({ object: "page", entry: [{ id: "p1", changes: [{ field: "leadgen", value: { leadgen_id: "L1" } }] }] }).events[0];
    expect(eventEnabled(lead, { leadSyncEnabled: false, inboxEnabled: true })).toBe(false);
    expect(eventEnabled(lead, { leadSyncEnabled: true, inboxEnabled: false })).toBe(true);
  });
});

describe("parseMetaSignedRequest", () => {
  const secret = "app-secret";

  it("accepts a correctly signed request", () => {
    const sr = signMetaRequest({ algorithm: "HMAC-SHA256", user_id: "12345", issued_at: 1 }, secret);
    expect(parseMetaSignedRequest(sr, secret)).toMatchObject({ user_id: "12345" });
  });

  it("rejects a wrong secret, tampered payload, bad algorithm or missing user", () => {
    const sr = signMetaRequest({ algorithm: "HMAC-SHA256", user_id: "12345" }, secret);
    expect(parseMetaSignedRequest(sr, "other")).toBeNull();
    const [sig] = sr.split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "999" })).toString("base64url");
    expect(parseMetaSignedRequest(`${sig}.${forged}`, secret)).toBeNull();
    expect(parseMetaSignedRequest(signMetaRequest({ algorithm: "none", user_id: "1" }, secret), secret)).toBeNull();
    expect(parseMetaSignedRequest(signMetaRequest({ algorithm: "HMAC-SHA256" }, secret), secret)).toBeNull();
    expect(parseMetaSignedRequest("garbage", secret)).toBeNull();
    expect(parseMetaSignedRequest(sr, undefined)).toBeNull();
  });
});
