// Meta (Facebook Login for Business): Pages, Instagram and Lead Ads.
//
// Meta has no refresh-token grant. We swap the short-lived user token for a
// long-lived one (~60 days) and store each Page's access token, which does
// not expire while the user's grant stands. When the user token nears
// expiry the tenant is asked to reconnect (see jobs/handlers/connection-refresh).

import { createHmac } from "crypto";
import { encryptApiKey } from "@/lib/crypto";
import { expiresAtFrom, form, providerFetch } from "../http";
import type { Env, ProviderDefinition, SocialAssetInput, TokenSet } from "../types";

// Every permission here needs Meta App Review before non-test users can grant it.
export const META_DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata", // subscribe Pages to webhooks
  "pages_messaging", // Messenger inbox
  "pages_manage_posts", // publish
  "pages_manage_engagement", // reply to / hide comments
  "pages_read_user_content", // read comments and visitor posts
  "read_insights",
  "leads_retrieval", // Lead Ads
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
];

/** Page webhook fields we subscribe to (POST /{page-id}/subscribed_apps). */
export const META_PAGE_WEBHOOK_FIELDS = ["leadgen", "messages", "messaging_postbacks", "feed"];

/** Graph API version. Keep current with Meta's changelog; override with META_GRAPH_VERSION. */
const DEFAULT_GRAPH_VERSION = "v24.0";

function version(env: Env) {
  return env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

export function graph(env: Env, path: string) {
  return `https://graph.facebook.com/${version(env)}${path}`;
}

/** Proves server-side Graph calls come from our app (Meta "appsecret_proof"). */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

export function authed(env: Env, accessToken: string, extra: Record<string, string> = {}) {
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
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

/** Pages + linked Instagram accounts as SocialAccount inputs. Page tokens are encrypted here. */
export function metaAssets(pages: MetaPage[]): SocialAssetInput[] {
  const out: SocialAssetInput[] = [];
  for (const p of pages) {
    // Page tokens are secrets: only encrypted envelopes leave this function.
    const token = p.access_token ? encryptApiKey(p.access_token) : null;
    out.push({
      platform: "facebook_page",
      externalId: p.id,
      name: p.name,
      pictureUrl: p.picture?.data?.url ?? null,
      tasks: p.tasks ?? [],
      accessToken: token,
    });
    const ig = p.instagram_business_account;
    if (ig) {
      out.push({
        platform: "instagram",
        externalId: ig.id,
        parentExternalId: p.id,
        name: ig.name || ig.username || p.name,
        username: ig.username ?? null,
        pictureUrl: ig.profile_picture_url ?? null,
        tasks: p.tasks ?? [],
        // The Instagram Graph API (via Facebook Login) uses the linked Page's token.
        accessToken: token,
      });
    }
  }
  return out;
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
        fields: "id,name,access_token,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
        limit: "100",
      })}`
    );
    return {
      externalAccountId: me.id,
      name: me.name,
      email: me.email,
      // Display-only summary; tokens live on SocialAccount rows (assets).
      metadata: {
        pages: pages.data.map((p) => ({
          id: p.id,
          name: p.name,
          instagram: p.instagram_business_account
            ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null }
            : null,
        })),
      },
      assets: metaAssets(pages.data),
    };
  },

  async revoke({ accessToken, env }) {
    await providerFetch(`${graph(env, "/me/permissions")}?${authed(env, accessToken)}`, { method: "DELETE" });
  },
};
