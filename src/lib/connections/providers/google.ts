// Google OAuth 2.0 (authorization code + PKCE, offline access).
// Scopes cover Search Console (read) and Business Profile, used in Phase 3.

import { expiresAtFrom, form, providerFetch } from "../http";
import type { ProviderDefinition, TokenSet } from "../types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/business.manage",
];

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

function toTokenSet(r: GoogleTokenResponse, previousRefresh?: string): TokenSet {
  return {
    accessToken: r.access_token,
    // Refresh responses usually omit refresh_token: keep the one we have.
    refreshToken: r.refresh_token ?? previousRefresh,
    expiresAt: expiresAtFrom(r.expires_in),
    scopes: (r.scope ?? "").split(" ").filter(Boolean),
  };
}

function scopes(env: Record<string, string | undefined>): string[] {
  return env.GOOGLE_OAUTH_SCOPES?.split(/[\s,]+/).filter(Boolean) ?? GOOGLE_DEFAULT_SCOPES;
}

export const googleProvider: ProviderDefinition = {
  id: "google",
  label: "Google",
  description: "Search Console and Business Profile, for search visibility and local SEO.",
  usesPkce: true,

  isConfigured: (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri, codeChallenge, env }) {
    const params = form({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes(env).join(" "),
      access_type: "offline",
      prompt: "consent", // guarantees a refresh_token on reconnect
      include_granted_scopes: "true",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallenge ? "S256" : undefined,
    });
    return `${AUTH_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier, env }) {
    const r = await providerFetch<GoogleTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    return toTokenSet(r);
  },

  async refresh({ refreshToken, env }) {
    const r = await providerFetch<GoogleTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        refresh_token: refreshToken,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    return toTokenSet(r, refreshToken);
  },

  async fetchAccount({ tokens }) {
    const me = await providerFetch<{ sub: string; email?: string; name?: string }>(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    return { externalAccountId: me.sub, email: me.email, name: me.name ?? me.email };
  },

  async revoke({ accessToken, refreshToken }) {
    // Revoking the refresh token also invalidates its access tokens.
    await providerFetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ token: refreshToken ?? accessToken }),
    });
  },
};
