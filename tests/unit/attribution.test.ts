import { describe, expect, it } from "vitest";
import { classifyChannel, parseAttribution, stripUrl, touchData, visitDedupeKey } from "@/lib/attribution";
import { collectIdentities, mergeProfile, normalizeEmail, normalizePhone } from "@/lib/contacts";

describe("classifyChannel", () => {
  const cases: [string, Parameters<typeof classifyChannel>[0], string][] = [
    ["campaign-tagged facebook link counts as paid social", { source: "facebook", campaign: "bf26" }, "social_paid"],
    ["facebook with social medium is organic", { source: "facebook", medium: "social" }, "social_organic"],
    ["facebook cpc is paid social", { source: "facebook", medium: "cpc" }, "social_paid"],
    ["google cpc is paid search", { source: "google", medium: "cpc" }, "paid_search"],
    ["gclid alone is paid search", { clickIdType: "gclid" }, "paid_search"],
    ["msclkid alone is paid search", { clickIdType: "msclkid" }, "paid_search"],
    ["li_fat_id is paid social", { clickIdType: "li_fat_id" }, "social_paid"],
    ["fbclid alone is organic social", { clickIdType: "fbclid" }, "social_organic"],
    ["email medium", { source: "newsletter", medium: "email" }, "email"],
    ["mailchimp source without medium", { source: "mailchimp" }, "email"],
    ["whatsapp source", { source: "whatsapp", medium: "chat" }, "whatsapp"],
    ["unknown tagged source is referral", { source: "partner-blog" }, "referral"],
    ["google referrer is organic search", { referrer: "https://www.google.co.uk/" }, "organic_search"],
    ["bing referrer is organic search", { referrer: "https://www.bing.com/search?q=x" }, "organic_search"],
    ["yahoo referrer is organic search", { referrer: "https://search.yahoo.com/" }, "organic_search"],
    ["l.facebook.com referrer is organic social", { referrer: "https://l.facebook.com/l.php" }, "social_organic"],
    ["t.co referrer is organic social", { referrer: "https://t.co/abc" }, "social_organic"],
    ["gmail referrer is email", { referrer: "https://mail.google.com/" }, "email"],
    ["other site referrer is referral", { referrer: "https://news.example.org/post" }, "referral"],
    [
      "self-referral is direct",
      { referrer: "https://shop.example.com/a", landingUrl: "https://shop.example.com/b" },
      "direct",
    ],
    ["nothing is direct", {}, "direct"],
    ["UTM beats referrer", { source: "google", medium: "cpc", referrer: "https://facebook.com/" }, "paid_search"],
  ];
  it.each(cases)("%s", (_name, input, channel) => {
    expect(classifyChannel(input).channel).toBe(channel);
  });

  it("names the source for referrer and click-id traffic", () => {
    expect(classifyChannel({ referrer: "https://www.google.com/" })).toMatchObject({ source: "google", medium: "organic" });
    expect(classifyChannel({ clickIdType: "msclkid" })).toMatchObject({ source: "bing", medium: "cpc" });
    expect(classifyChannel({ referrer: "https://www.news.example.org/x" }).source).toBe("news.example.org");
  });
});

describe("attribution payloads", () => {
  it("strips query strings and fragments from URLs", () => {
    expect(stripUrl("https://a.com/p?email=me@x.com#t")).toBe("https://a.com/p");
    expect(stripUrl("javascript:alert(1)")).toBeNull();
    expect(stripUrl("not a url")).toBeNull();
  });

  it("parses valid payloads and rejects junk without throwing", () => {
    expect(parseAttribution({ first: { source: "google", sessionId: "s1" } })?.first?.source).toBe("google");
    expect(parseAttribution({})).toBeNull();
    expect(parseAttribution("nope")).toBeNull();
    expect(parseAttribution({ first: { clickIdType: "evil" } })).toBeNull();
    expect(parseAttribution({ first: { source: "x".repeat(5000) } })).toBeNull();
  });

  it("builds a touchpoint row from a widget touch", () => {
    const row = touchData({
      businessId: "b1",
      kind: "visit",
      visitorId: "v1",
      touch: {
        sessionId: "s1",
        source: "Facebook",
        campaign: "bf26",
        landingUrl: "https://shop.example.com/?utm_source=facebook&utm_campaign=bf26",
        referrer: null,
        clickIdType: "fbclid",
        clickId: null,
      },
    });
    expect(row).toMatchObject({
      channel: "social_paid",
      source: "facebook",
      campaign: "bf26",
      landingUrl: "https://shop.example.com/",
      clickIdType: null, // no click id value, so no type
    });
  });

  it("ignores client timestamps in the future", () => {
    const future = new Date(Date.now() + 86_400_000);
    const row = touchData({ businessId: "b", kind: "visit", touch: { at: future } });
    expect((row.occurredAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("keys visits per visitor per browser session", () => {
    expect(visitDedupeKey("b", "v", "s")).toBe("visit:b:v:s");
    expect(visitDedupeKey("b", "v".repeat(300), "s").length).toBe(191);
  });
});

describe("contact identity normalisation", () => {
  it("normalises emails and phones", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizePhone("+44 (0)20 7946-0958")).toBe("+4402079460958");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("0803 123 4567")).toBe("08031234567");
    expect(normalizePhone("123")).toBeNull();
  });

  it("collects de-duplicated identities including the profile email/phone", () => {
    const ids = collectIdentities(
      [
        { type: "visitor", value: "v_1" },
        { type: "email", value: "JANE@example.com" },
        { type: "visitor", value: "" },
      ],
      { email: "jane@example.com", phone: "+1 555 010 9999" }
    );
    expect(ids).toEqual([
      { type: "visitor", value: "v_1" },
      { type: "email", value: "jane@example.com" },
      { type: "phone", value: "+15550109999" },
    ]);
  });

  it("keeps the survivor's profile fields and fills blanks", () => {
    const merged = mergeProfile(
      [
        { name: "Jane", email: null, phone: null, company: null },
        { name: "J.", email: "jane@example.com", phone: null, company: "Acme" },
      ],
      { name: "Jane Doe", phone: "+15550109999" }
    );
    expect(merged).toEqual({ name: "Jane", email: "jane@example.com", phone: "+15550109999", company: "Acme" });
  });
});
