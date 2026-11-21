import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "crypto";
import { createOAuthState, createPkcePair, verifyOAuthState, OAUTH_STATE_TTL_MS } from "@/lib/connections/state";
import { googleProvider, GOOGLE_DEFAULT_SCOPES } from "@/lib/connections/providers/google";
import { appSecretProof, metaProvider } from "@/lib/connections/providers/meta";
import { callbackUrl, getConnectionProvider, listConnectionProviders } from "@/lib/connections/registry";
import { expiresAtFrom, providerFetch } from "@/lib/connections/http";
import { OAuthGrantError, OAuthProviderError } from "@/lib/connections/types";
import { needsRefresh } from "@/lib/connections/tokens";
import { toPublicConnection } from "@/lib/connections/store";
import { encryptApiKey } from "@/lib/crypto";

// activity.ts is server-only (next/headers); tokens.ts only needs createNotification.
vi.mock("@/lib/activity", () => ({ createNotification: vi.fn() }));

const who = { provider: "google" as const, businessId: "biz_1", userId: "user_1" };

describe("OAuth state", () => {
  it("round-trips and carries the PKCE verifier", () => {
    const s = createOAuthState({ ...who, pkce: true });
    const check = verifyOAuthState({ ...who, cookieValue: s.cookieValue, state: s.state });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.payload.codeVerifier).toBeTruthy();
    const expectedChallenge = createHash("sha256").update(check.payload.codeVerifier!).digest("base64url");
    expect(s.codeChallenge).toBe(expectedChallenge);
  });

  it("does not expose the nonce or verifier in the cookie", () => {
    const s = createOAuthState({ ...who, pkce: true });
    const decoded = Buffer.from(s.cookieValue, "base64url").toString("utf8");
    expect(decoded).not.toContain(s.state);
    expect(decoded).not.toContain("user_1");
  });

  it("rejects a different state, user, business or provider", () => {
    const s = createOAuthState({ ...who, pkce: false });
    const base = { ...who, cookieValue: s.cookieValue, state: s.state };
    expect(verifyOAuthState({ ...base, state: "forged" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyOAuthState({ ...base, userId: "other" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyOAuthState({ ...base, businessId: "other" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyOAuthState({ ...base, provider: "meta" })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects missing, tampered and expired cookies", () => {
    const now = Date.now();
    const s = createOAuthState({ ...who, pkce: false, now });
    expect(verifyOAuthState({ ...who, cookieValue: undefined, state: s.state }).ok).toBe(false);
    expect(verifyOAuthState({ ...who, cookieValue: s.cookieValue.slice(0, -4) + "AAAA", state: s.state })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      verifyOAuthState({ ...who, cookieValue: s.cookieValue, state: s.state, now: now + OAUTH_STATE_TTL_MS + 1 })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("generates RFC 7636-sized verifiers", () => {
    const { verifier } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });
});

describe("providers", () => {
  const env = {
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsecret",
    LINKEDIN_CLIENT_ID: "lid",
    LINKEDIN_CLIENT_SECRET: "lsecret",
    META_APP_ID: "mid",
    META_APP_SECRET: "msecret",
    NEXT_PUBLIC_APP_URL: "https://app.example.com/",
  };

  it("builds a Google consent URL with offline access and PKCE", () => {
    const url = new URL(googleProvider.authorizeUrl({ state: "st", redirectUri: "https://cb", codeChallenge: "ch", env }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_DEFAULT_SCOPES.join(" "));
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("builds a Meta consent URL with comma-separated scopes and no secret", () => {
    const url = new URL(metaProvider.authorizeUrl({ state: "st", redirectUri: "https://cb", env }));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("scope")).toContain("leads_retrieval,");
    expect(url.toString()).not.toContain("msecret");
  });

  it("computes appsecret_proof as HMAC-SHA256(token, secret)", () => {
    expect(appSecretProof("tok", "sec")).toBe(createHmac("sha256", "sec").update("tok").digest("hex"));
  });

  it("reports configuration from env and builds callback URLs", () => {
    expect(listConnectionProviders({}).every((p) => !p.configured)).toBe(true);
    expect(listConnectionProviders(env).every((p) => p.configured)).toBe(true);
    expect(callbackUrl("meta", env)).toBe("https://app.example.com/api/connections/meta/callback");
    expect(getConnectionProvider("toString")).toBeUndefined();
    expect(getConnectionProvider("google")?.id).toBe("google");
  });
});

describe("providerFetch error classification", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(status: number, body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  }

  it("treats invalid_grant and Meta OAuthException as grant errors", async () => {
    stub(400, { error: "invalid_grant", error_description: "Token has been revoked." });
    await expect(providerFetch("https://x")).rejects.toBeInstanceOf(OAuthGrantError);
    stub(400, { error: { message: "Session expired", type: "OAuthException", code: 190 } });
    await expect(providerFetch("https://x")).rejects.toBeInstanceOf(OAuthGrantError);
  });

  it("treats 5xx and rate limits as transient", async () => {
    stub(503, { error: "backend" });
    await expect(providerFetch("https://x")).rejects.toBeInstanceOf(OAuthProviderError);
    stub(429, { error: { message: "slow down" } });
    await expect(providerFetch("https://x")).rejects.toBeInstanceOf(OAuthProviderError);
  });

  it("returns parsed JSON on success", async () => {
    stub(200, { ok: 1 });
    await expect(providerFetch("https://x")).resolves.toEqual({ ok: 1 });
  });
});

describe("token helpers", () => {
  it("refreshes only near expiry, never for non-expiring tokens", () => {
    const now = Date.now();
    expect(needsRefresh(null, now)).toBe(false);
    expect(needsRefresh(new Date(now + 60 * 60_000), now)).toBe(false);
    expect(needsRefresh(new Date(now + 60_000), now)).toBe(true);
    expect(needsRefresh(new Date(now - 1), now)).toBe(true);
  });

  it("converts expires_in to a date", () => {
    expect(expiresAtFrom(3600, 0)?.getTime()).toBe(3_600_000);
    expect(expiresAtFrom(undefined)).toBeNull();
  });

  it("never exposes tokens in the public view", () => {
    const row = {
      id: "c1",
      businessId: "b",
      provider: "meta",
      externalAccountId: "123",
      accountName: "Acme",
      accountEmail: null,
      scopes: "pages_show_list leads_retrieval",
      accessToken: encryptApiKey("user-token"),
      refreshToken: null,
      expiresAt: null,
      status: "active",
      lastError: null,
      lastRefreshedAt: null,
      metadata: { pages: [{ id: "p1", name: "Acme Page", accessToken: encryptApiKey("page-token"), instagram: null }] },
      connectedById: "u",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
    const pub = toPublicConnection(row);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("ciphertext");
    expect(json).not.toContain("accessToken");
    expect(pub.scopes).toEqual(["pages_show_list", "leads_retrieval"]);
    expect(pub.assets).toEqual([{ id: "p1", name: "Acme Page", instagram: null }]);
  });
});
