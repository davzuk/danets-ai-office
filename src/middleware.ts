import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-danets-method", request.method);
  requestHeaders.set("x-danets-pathname", pathname);

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
    return NextResponse.redirect(new URL("/platform", request.url));
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
