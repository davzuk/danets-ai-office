// LinkedIn (Sign In with LinkedIn using OpenID Connect + Community Management
// API): the Pages (organizations) a member administers, for publishing and
// Lead Gen Forms.
//
// Access tokens last 60 days; refresh tokens (365 days) are issued to apps
// approved for the Marketing / Community Management programs, and the hourly
// connections.refresh job uses them. Organization calls use the member's
// token, so linkedin_page SocialAccount rows carry no token of their own.

import { expiresAtFrom, form, providerFetch } from "../http";
import type { Env, ProviderDefinition, SocialAssetInput, TokenSet } from "../types";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
export const LINKEDIN_REST = "https://api.linkedin.com/rest";

export const LINKEDIN_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_organization_social", // post as the Page
  "r_organization_social", // read the Page's posts (analytics, workstream M)
  "rw_organization_admin", // list the Pages the member administers
];

/** Added to the default scopes once LinkedIn approves the Lead Sync API for the app. */
export const LINKEDIN_LEADS_SCOPE = "r_marketing_leadgen_automation";

/**
 * Versioned API (YYYYMM). LinkedIn retires a version about a year after
 * release, so bump this regularly; override with LINKEDIN_API_VERSION.
 */
export const DEFAULT_LINKEDIN_VERSION = "202610";

export function linkedinVersion(env: Env) {
  return env.LINKEDIN_API_VERSION || DEFAULT_LINKEDIN_VERSION;
}

export function linkedinHeaders(env: Env, token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": linkedinVersion(env),
    "X-Restli-Protocol-Version": "2.0.0",
    ...extra,
  };
}

export function linkedinScopes(env: Env): string[] {
  const configured = env.LINKEDIN_OAUTH_SCOPES?.split(/[\s,]+/).filter(Boolean);
  if (configured?.length) return configured;
  return env.LINKEDIN_LEAD_SYNC === "true" ? [...LINKEDIN_DEFAULT_SCOPES, LINKEDIN_LEADS_SCOPE] : LINKEDIN_DEFAULT_SCOPES;
}

export const orgUrn = (id: string) => (id.startsWith("urn:") ? id : `urn:li:organization:${id}`);
export const orgIdFromUrn = (urn: string) => urn.replace(/^urn:li:organization:/, "");

interface LinkedInTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

function toTokenSet(r: LinkedInTokenResponse, previousRefresh?: string): TokenSet {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previousRefresh,
    expiresAt: expiresAtFrom(r.expires_in),
    scopes: (r.scope ?? "").split(/[\s,]+/).filter(Boolean),
  };
}

interface OrgAcl {
  organization?: string;
  role?: string;
  state?: string;
}

interface Organization {
  id?: number | string;
  localizedName?: string;
  vanityName?: string;
  logoV2?: { original?: string; cropped?: string; "original~"?: unknown };
}

/** Organizations the member administers, as SocialAccount inputs. */
export function linkedinAssets(acls: OrgAcl[], orgs: Map<string, Organization>): SocialAssetInput[] {
  const seen = new Set<string>();
  const out: SocialAssetInput[] = [];
  for (const acl of acls) {
    if (!acl.organization || (acl.state && acl.state !== "APPROVED")) continue;
    const id = orgIdFromUrn(acl.organization);
    if (seen.has(id)) continue;
    seen.add(id);
    const org = orgs.get(id);
    out.push({
      platform: "linkedin_page",
      externalId: id,
      name: org?.localizedName || `LinkedIn Page ${id}`,
      username: org?.vanityName ?? null,
      pictureUrl: null, // logos are image URNs; resolving them costs a call per Page
      tasks: acl.role ? [acl.role] : [],
      accessToken: null,
    });
  }
  return out;
}

async function listAdminOrganizations(token: string, env: Env): Promise<SocialAssetInput[]> {
  const acls: OrgAcl[] = [];
  let start = 0;
  for (let page = 0; page < 10; page++) {
    const r = await providerFetch<{ elements?: OrgAcl[]; paging?: { total?: number } }>(
      `${LINKEDIN_REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&start=${start}&count=100`,
      { headers: linkedinHeaders(env, token) }
    );
    const els = r.elements ?? [];
    acls.push(...els);
    start += els.length;
    if (els.length < 100 || (r.paging?.total !== undefined && start >= r.paging.total)) break;
  }

  const orgs = new Map<string, Organization>();
  const ids = [...new Set(acls.map((a) => (a.organization ? orgIdFromUrn(a.organization) : null)).filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const r = await providerFetch<{ results?: Record<string, Organization> }>(
        `${LINKEDIN_REST}/organizations?ids=List(${batch.map(encodeURIComponent).join(",")})`,
        { headers: linkedinHeaders(env, token) }
      );
      for (const [id, org] of Object.entries(r.results ?? {})) orgs.set(orgIdFromUrn(id), org);
    } catch {
      // Names are cosmetic; the Pages still connect.
    }
  }
  return linkedinAssets(acls, orgs);
}

export const linkedinProvider: ProviderDefinition = {
  id: "linkedin",
  label: "LinkedIn",
  description: "LinkedIn Pages, for scheduled posts and Lead Gen Forms.",
  usesPkce: false, // confidential client: the code exchange uses the client secret

  isConfigured: (env) => !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),

  authorizeUrl({ state, redirectUri, env }) {
    const params = form({
      response_type: "code",
      client_id: env.LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: linkedinScopes(env).join(" "),
    });
    return `${AUTH_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri, env }) {
    const r = await providerFetch<LinkedInTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    return toTokenSet(r);
  },

  async refresh({ refreshToken, env }) {
    const r = await providerFetch<LinkedInTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    return toTokenSet(r, refreshToken);
  },

  async fetchAccount({ tokens, env }) {
    const me = await providerFetch<{ sub: string; name?: string; email?: string }>(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const assets = await listAdminOrganizations(tokens.accessToken, env);
    return {
      externalAccountId: me.sub,
      name: me.name ?? me.email,
      email: me.email,
      metadata: { pages: assets.map((a) => ({ id: a.externalId, name: a.name })) },
      assets,
    };
  },

  async revoke({ accessToken, env }) {
    await providerFetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET, token: accessToken }),
    });
  },
};
