import { cookies } from "next/headers";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { callbackUrl, getConnectionProvider } from "@/lib/connections/registry";
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, type ConnectPurpose } from "@/lib/connections/state";
import { GOOGLE_CALENDAR_SCOPES } from "@/lib/booking/google-calendar";
import { GOOGLE_SEO_SCOPES } from "@/lib/seo/google";
import { isModuleEnabled } from "@/lib/module-access";

type RouteCtx = { params: Promise<{ provider: string }> };

/**
 * POST /api/connections/[provider]/start — begin an OAuth connect.
 * Returns the provider's consent URL; the client navigates to it.
 * POST (not GET) so the session's CSRF check applies.
 */
export function POST(req: Request, { params }: RouteCtx) {
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

    // { purpose: "calendar" } adds the Calendar scopes (Google only), so
    // tenants are asked for calendar access only when they turn sync on.
    // { purpose: "seo" } makes sure the Search Console and Business Profile
    // scopes are asked for, and returns to SEO → Setup.
    const body = (await req.json().catch(() => null)) as { purpose?: unknown } | null;
    let purpose: ConnectPurpose | undefined;
    if (body?.purpose !== undefined) {
      if ((body.purpose !== "calendar" && body.purpose !== "seo") || provider.id !== "google") {
        throw new AppError("Unknown connect purpose.", { status: 400, code: "INVALID_INPUT" });
      }
      if (body.purpose === "calendar" && !(await isModuleEnabled(user.businessId, "booking_sync"))) {
        throw new AppError("Calendar sync for bookings needs the Pro plan.", { status: 403, code: "MODULE_DISABLED" });
      }
      if (body.purpose === "seo" && !(await isModuleEnabled(user.businessId, "seo"))) {
        throw new AppError("SEO needs the Pro plan.", { status: 403, code: "MODULE_DISABLED" });
      }
      purpose = body.purpose;
    }

    const { state, codeChallenge, cookieValue } = createOAuthState({
      provider: provider.id,
      businessId: user.businessId,
      userId: user.userId,
      pkce: provider.usesPkce,
      purpose,
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
      extraScopes: purpose === "calendar" ? GOOGLE_CALENDAR_SCOPES : purpose === "seo" ? GOOGLE_SEO_SCOPES : undefined,
    });
    return { url };
  });
}
