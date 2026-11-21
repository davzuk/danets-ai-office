// Meta (Facebook Login for Business): Pages, Instagram and Lead Ads.
//
// Meta has no refresh-token grant. We swap the short-lived user token for a
// long-lived one (~60 days) and store each Page's access token, which does
// not expire while the user's grant stands. When the user token nears
// expiry the tenant is asked to reconnect (see jobs/handlers/connection-refresh).

import { createHmac } from "crypto";
import { encryptApiKey } from "@/lib/crypto";
import { expiresAtFrom, form, providerFetch } from "../http";
import type { Env, ProviderDefinition, TokenSet } from "../types";

export const META_DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "leads_retrieval",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
];

/** Graph API version. Keep current with Meta's changelog; override with META_GRAPH_VERSION. */
const DEFAULT_GRAPH_VERSION = "v24.0";

function version(env: Env) {
  return env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

function graph(env: Env, path: string) {
  return `https://graph.facebook.com/${version(env)}${path}`;
}

/** Proves server-side Graph calls come from our app (Meta "appsecret_proof"). */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

function authed(env: Env, accessToken: string, extra: Record<string, string> = {}) {
  return form({
    ...extra,
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken, env.META_APP_SECRET ?? ""),
  });
}

function scopes(env: Env): string[] {
  return env.META_OAUTH_SCOPES?.split(/[\s,]+/).filter(Boolean) ?? META_DEFAULT_SCOPES;
}

interface MetaTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface MetaPage {
  id: string;
  name: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string };
}

export const metaProvider: ProviderDefinition = {
  id: "meta",
  label: "Meta (Facebook & Instagram)",
  description: "Facebook Pages, Instagram and Lead Ads, for social lead capture and the social inbox.",
  usesPkce: false, // confidential client: the code exchange is authenticated with the app secret

  isConfigured: (env) => !!(env.META_APP_ID && env.META_APP_SECRET),

  authorizeUrl({ state, redirectUri, env }) {
    const params = form({
      client_id: env.META_APP_ID,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: scopes(env).join(","),
    });
    return `https://www.facebook.com/${version(env)}/dialog/oauth?${params}`;
  },

  async exchangeCode({ code, redirectUri, env }) {
    const short = await providerFetch<MetaTokenResponse>(
      `${graph(env, "/oauth/access_token")}?${form({
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      })}`
    );
    const long = await providerFetch<MetaTokenResponse>(
      `${graph(env, "/oauth/access_token")}?${form({
        grant_type: "fb_exchange_token",
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        fb_exchange_token: short.access_token,
      })}`
    );

    // Meta's token response doesn't list scopes; ask which were granted.
    const perms = await providerFetch<{ data: { permission: string; status: string }[] }>(
      `${graph(env, "/me/permissions")}?${authed(env, long.access_token)}`
    );
    const tokens: TokenSet = {
      accessToken: long.access_token,
      expiresAt: expiresAtFrom(long.expires_in),
      scopes: perms.data.filter((p) => p.status === "granted").map((p) => p.permission),
    };
    return tokens;
  },

  async fetchAccount({ tokens, env }) {
    const me = await providerFetch<{ id: string; name?: string; email?: string }>(
      `${graph(env, "/me")}?${authed(env, tokens.accessToken, { fields: "id,name,email" })}`
    );
    const pages = await providerFetch<{ data: MetaPage[] }>(
      `${graph(env, "/me/accounts")}?${authed(env, tokens.accessToken, {
        fields: "id,name,access_token,tasks,instagram_business_account{id,username}",
        limit: "100",
      })}`
    );
    return {
      externalAccountId: me.id,
      name: me.name,
      email: me.email,
      metadata: {
        pages: pages.data.map((p) => ({
          id: p.id,
          name: p.name,
          tasks: p.tasks ?? [],
          // Page tokens are secrets: stored only as encrypted envelopes.
          accessToken: p.access_token ? encryptApiKey(p.access_token) : null,
          instagram: p.instagram_business_account
            ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null }
            : null,
        })),
      },
    };
  },

  async revoke({ accessToken, env }) {
    await providerFetch(`${graph(env, "/me/permissions")}?${authed(env, accessToken)}`, { method: "DELETE" });
  },
};
