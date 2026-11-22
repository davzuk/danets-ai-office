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

// 16 random bytes → 32-char hex string. Base64url would be 22 chars,
// but the CSP spec only allows character set [A-Za-z0-9+/=-_] for the
// nonce — both work, hex is easier to inspect when debugging.
const mintNonce = (): string => {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }
  // Last-ditch — Math.random is NOT cryptographically secure, so we
  // additionally fold in Date.now + a counter. Only used in non-Edge
  // test environments.
  return `nonce-${Date.now().toString(16)}-${Math.random().toString(36).slice(2, 10)}`;
};

// Per-page CSP. The 'nonce-{NONCE}' token lets us drop 'unsafe-inline'
// from the script-src list — every <script> that runs must carry the
// nonce. We pair it with 'strict-dynamic' so scripts loaded by a
// nonced script (which is how Next.js's hydration bootstrap works) are
// also allowed. This is the recommended pattern from the CSP spec for
// modern SSR frameworks.
const CSP_BASE = [
  "default-src 'self'",
  // nonce is filled in below; 'strict-dynamic' + 'unsafe-inline' for
  // the initial bootstrap only — modern browsers honour the nonce and
  // ignore the inline allowance once a nonced script loads.
  "script-src 'self' 'unsafe-inline' 'strict-dynamic' https://js.paystack.co https://checkout.flutterwave.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.paystack.co https://api.flutterwave.com wss:",
  // calendly.com: booking types that embed a Calendly scheduling page.
  "frame-src https://js.paystack.co https://checkout.flutterwave.com https://calendly.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Honor an upstream-provided request ID (load balancer, edge worker) so
  // tracing stays consistent end-to-end. Mint a fresh UUID otherwise — every
  // request gets a stable correlation id that the logger picks up via
  // `getRequestContext()` inside API handlers.
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && incoming.length > 0 ? incoming : mintRequestId();

  // Per-request CSP nonce. The browser receives a fresh nonce with
  // every navigation, so even if an attacker somehow smuggles a
  // <script> tag into the rendered HTML, it can't execute without the
  // matching nonce — and the nonce is unguessable.
  const nonce = mintNonce();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-danets-method", request.method);
  requestHeaders.set("x-danets-pathname", pathname);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-csp-nonce", nonce);

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

  // Build the page CSP with the per-request nonce baked in. The API
  // routes get their own tighter policy from next.config — the nonce
  // path doesn't apply there (APIs don't run scripts).
  const cspValue = [
    ...CSP_BASE.slice(0, 1),
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.paystack.co https://checkout.flutterwave.com`,
    ...CSP_BASE.slice(2),
  ].join("; ");

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", cspValue);
  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/api/:path*"],
};