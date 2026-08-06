import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge runtime doesn't have Node `crypto`, so we use the Web Crypto
// `randomUUID` available globally on the Edge platform.
const mintRequestId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Last-ditch fallback — never expected on Edge, only Node tests.
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Honor an upstream-provided request ID (load balancer, edge worker) so
  // tracing stays consistent end-to-end. Mint a fresh UUID otherwise — every
  // request gets a stable correlation id that the logger picks up via
  // `getRequestContext()` inside API handlers.
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && incoming.length > 0 ? incoming : mintRequestId();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-danets-method", request.method);
  requestHeaders.set("x-danets-pathname", pathname);
  requestHeaders.set("x-request-id", requestId);

  const platformSession = request.cookies.get("danets_platform_session");
  const platformImpersonator = request.cookies.get(
    "danets_platform_impersonator"
  );
  const tenantImpersonator = request.cookies.get("danets_impersonator");

  // Platform admins (not impersonating) belong on /platform, not the tenant app.
  if (
    pathname === "/" &&
    platformSession &&
    !platformImpersonator &&
    !tenantImpersonator
  ) {
    const redirect = NextResponse.redirect(new URL("/platform", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/", "/api/:path*"],
};