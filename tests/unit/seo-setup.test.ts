import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { toSearchSites, toGbpLocations, formatAddress, seoScopes, classifyGoogleError, GOOGLE_SEO_SCOPES } = await import("@/lib/seo/google");
const { outcomeForError } = await import("@/lib/seo/setup");
const { OAuthProviderError } = await import("@/lib/connections/types");
const { ConnectionUnavailableError } = await import("@/lib/connections/tokens");
const { resolveModuleFromApiPath } = await import("@/lib/module-registry");
const { LIMIT_KEYS } = await import("@/lib/limit-fields");

describe("Search Console properties", () => {
  it("keeps readable properties, domain ones first, with a display label", () => {
    const sites = toSearchSites({
      siteEntry: [
        { siteUrl: "https://www.acme.test/blog/", permissionLevel: "siteFullUser" },
        { siteUrl: "sc-domain:acme.test", permissionLevel: "siteOwner" },
        { siteUrl: "https://other.test/", permissionLevel: "siteUnverifiedUser" },
        { siteUrl: "", permissionLevel: "siteOwner" },
      ],
    });
    expect(sites).toEqual([
      { siteUrl: "sc-domain:acme.test", permission: "siteOwner", kind: "domain", label: "acme.test" },
      { siteUrl: "https://www.acme.test/blog/", permission: "siteFullUser", kind: "url_prefix", label: "www.acme.test/blog/" },
    ]);
    expect(toSearchSites(null)).toEqual([]);
    expect(toSearchSites({})).toEqual([]);
  });
});

describe("Business Profile locations", () => {
  it("maps names, address and review link", () => {
    const [loc, untitled] = toGbpLocations("accounts/1", {
      locations: [
        {
          name: "locations/9",
          title: " Acme Roofing ",
          storefrontAddress: { addressLines: ["1 High St", ""], locality: "Leeds", postalCode: "LS1 1AA", regionCode: "GB" },
          metadata: { mapsUri: "https://maps.google.com/?cid=1", newReviewUri: "https://search.google.com/local/writereview?placeid=x" },
        },
        { name: "locations/10" },
        { title: "no name, dropped" },
      ],
    });
    expect(loc).toEqual({
      accountName: "accounts/1",
      locationName: "locations/9",
      title: "Acme Roofing",
      address: "1 High St, Leeds, LS1 1AA, GB",
      mapsUri: "https://maps.google.com/?cid=1",
      reviewUri: "https://search.google.com/local/writereview?placeid=x",
    });
    expect(untitled).toMatchObject({ title: "Untitled location", address: null, reviewUri: null });
    expect(formatAddress(undefined)).toBeNull();
    expect(formatAddress({ addressLines: [" "] })).toBeNull();
  });
});

describe("granted scopes", () => {
  it("tells which SEO features a grant covers", () => {
    expect(seoScopes(GOOGLE_SEO_SCOPES)).toEqual({ searchConsole: true, businessProfile: true });
    expect(seoScopes("openid email https://www.googleapis.com/auth/webmasters")).toEqual({ searchConsole: true, businessProfile: false });
    expect(seoScopes("")).toEqual({ searchConsole: false, businessProfile: false });
  });
});

describe("Google failures", () => {
  it("separates lost access, missing API approval and transient errors", () => {
    expect(classifyGoogleError(new OAuthProviderError("User does not have sufficient permission", 403))).toBe("lost_access");
    expect(classifyGoogleError(new OAuthProviderError("Not found", 404))).toBe("lost_access");
    expect(classifyGoogleError(new OAuthProviderError("Quota exceeded for quota metric 'Requests'", 429))).toBe("not_approved");
    expect(classifyGoogleError(new OAuthProviderError("My Business Account Management API has not been used in project 123 before or it is disabled", 403))).toBe("not_approved");
    expect(classifyGoogleError(new OAuthProviderError("Backend error", 503))).toBe("retry");
    expect(classifyGoogleError(new Error("boom"))).toBe("retry");
  });

  it("decides what a failed health check does to the stored row", () => {
    expect(outcomeForError(new OAuthProviderError("Forbidden", 403), "property")).toMatchObject({ status: "lost_access" });
    expect(outcomeForError(new OAuthProviderError("Forbidden", 403), "location").error).toMatch(/manager/);
    expect(outcomeForError(new ConnectionUnavailableError("c1", "revoked"), "property")).toMatchObject({ status: "error", error: expect.stringMatching(/reconnecting/) });
    expect(outcomeForError(new OAuthProviderError("Quota exceeded", 429), "location").error).toMatch(/hasn't enabled Business Profile/);
    expect(outcomeForError(new OAuthProviderError("Backend error", 500), "property")).toMatchObject({ retry: true });
  });
});

describe("packaging", () => {
  it("gates the SEO API and exposes the new limits to the console", () => {
    expect(resolveModuleFromApiPath("/api/seo/setup")).toBe("seo");
    expect(resolveModuleFromApiPath("/api/seo/google/sites")).toBe("seo");
    expect(LIMIT_KEYS).toEqual(expect.arrayContaining(["seoPropertyLimit", "gbpLocationLimit"]));
  });
});
