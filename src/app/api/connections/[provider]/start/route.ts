import { cookies } from "next/headers";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { callbackUrl, getConnectionProvider } from "@/lib/connections/registry";
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS } from "@/lib/connections/state";

type RouteCtx = { params: Promise<{ provider: string }> };

/**
 * POST /api/connections/[provider]/start — begin an OAuth connect.
 * Returns the provider's consent URL; the client navigates to it.
 * POST (not GET) so the session's CSRF check applies.
 */
export function POST(_req: Request, { params }: RouteCtx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");

    const { provider: id } = await params;
    const provider = getConnectionProvider(id);
    if (!provider) throw new AppError("Unknown provider", { status: 404, code: "NOT_FOUND" });
    if (!provider.isConfigured(process.env)) {
      throw new AppError(`${provider.label} is not configured on this server yet.`, {
        status: 409,
        code: "PROVIDER_NOT_CONFIGURED",
      });
    }

    const { state, codeChallenge, cookieValue } = createOAuthState({
      provider: provider.id,
      businessId: user.businessId,
      userId: user.userId,
      pkce: provider.usesPkce,
    });

    const cookieStore = await cookies();
    cookieStore.set(OAUTH_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // lax: the browser must send it on the top-level redirect back from the provider
      sameSite: "lax",
      path: `/api/connections/${provider.id}/callback`,
      maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    });

    const url = provider.authorizeUrl({
      state,
      redirectUri: callbackUrl(provider.id),
      codeChallenge,
      env: process.env,
    });
    return { url };
  });
}
