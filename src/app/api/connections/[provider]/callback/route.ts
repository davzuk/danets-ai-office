import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { logger, serializeError } from "@/lib/logger";
import { callbackUrl, getConnectionProvider } from "@/lib/connections/registry";
import { OAUTH_STATE_COOKIE, verifyOAuthState } from "@/lib/connections/state";
import { saveConnection } from "@/lib/connections/store";
import { OAuthGrantError } from "@/lib/connections/types";
import { enqueue } from "@/lib/jobs";
import { socialSubscribeJob } from "@/lib/jobs/handlers/social-subscribe";
import { syncSocialAccounts } from "@/lib/social/accounts";

type RouteCtx = { params: Promise<{ provider: string }> };

function backToApp(
  req: NextRequest,
  provider: string,
  status: "connected" | "error",
  reason?: string,
  extra: Record<string, string> = {}
) {
  const url = new URL("/app", req.nextUrl.origin);
  url.searchParams.set("view", "integrations");
  url.searchParams.set("connection", provider);
  url.searchParams.set("status", status);
  if (reason) url.searchParams.set("reason", reason);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  // One-shot: the state cookie is never reusable.
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: `/api/connections/${provider}/callback`, maxAge: 0 });
  return res;
}

/**
 * GET /api/connections/[provider]/callback — the provider redirects here
 * after consent. Verifies state against the encrypted cookie, exchanges the
 * code, stores the connection, and returns the user to Integrations.
 */
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const { provider: id } = await params;
  const provider = getConnectionProvider(id);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  if (session.role !== "admin") return backToApp(req, provider.id, "error", "forbidden");

  const q = req.nextUrl.searchParams;
  // User declined on the consent screen.
  if (q.get("error")) return backToApp(req, provider.id, "error", "denied");

  const check = verifyOAuthState({
    cookieValue: req.cookies.get(OAUTH_STATE_COOKIE)?.value,
    state: q.get("state"),
    provider: provider.id,
    businessId: session.businessId,
    userId: session.userId,
  });
  if (!check.ok) {
    logger.warn("OAuth callback rejected: bad state", { provider: provider.id, reason: check.reason });
    return backToApp(req, provider.id, "error", "state");
  }

  const code = q.get("code");
  if (!code) return backToApp(req, provider.id, "error", "missing_code");

  try {
    const tokens = await provider.exchangeCode({
      code,
      redirectUri: callbackUrl(provider.id),
      codeVerifier: check.payload.codeVerifier,
      env: process.env,
    });
    const account = await provider.fetchAccount({ tokens, env: process.env });
    const conn = await saveConnection({
      businessId: session.businessId,
      userId: session.userId,
      provider: provider.id,
      tokens,
      account,
    });

    // Pages / IG accounts become SocialAccount rows; Pages get webhook subscriptions.
    let conflicts = 0;
    if (account.assets) {
      const sync = await syncSocialAccounts(conn, account.assets);
      conflicts = sync.conflicts.length;
      for (const row of sync.synced) {
        if (row.platform !== "facebook_page") continue;
        await enqueue(
          socialSubscribeJob,
          { socialAccountId: row.id },
          { businessId: session.businessId, dedupeKey: `social-subscribe:${row.id}:${row.updatedAt.getTime()}` }
        );
      }
    }

    await logActivity({
      businessId: session.businessId,
      userId: session.userId,
      userName: session.name,
      action: "connection_added",
      module: "integrations",
      description: `Connected ${provider.label} account ${account.name ?? account.externalAccountId}`,
      metadata: { connectionId: conn.id, provider: provider.id, scopes: tokens.scopes, assets: account.assets?.length ?? 0, conflicts },
    });
    return backToApp(req, provider.id, "connected", undefined, conflicts ? { conflicts: String(conflicts) } : {});
  } catch (e) {
    logger.error("OAuth connect failed", { provider: provider.id, ...serializeError(e) });
    return backToApp(req, provider.id, "error", e instanceof OAuthGrantError ? "rejected" : "provider");
  }
}
