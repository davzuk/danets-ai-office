import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PAGE_SLUG_RE, RESERVED_PAGE_SLUGS, isSitesOnlyHost, siteSubdomainFromHost } from "@/lib/sites/host";

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
  // 'self': the website editor's live preview (/site-preview).
  "frame-src 'self' https://js.paystack.co https://checkout.flutterwave.com https://calendly.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const appOrigin = (): string => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
};

/**
 * CSP for tenant website pages: nonce-only scripts (Next's own and the chat
 * widget, which the layout tags with the nonce), images from anywhere over
 * https plus the app's media, and video embeds from YouTube and Vimeo only.
 */
function tenantCsp(nonce: string): string {
  const app = appOrigin();
  return [
    "default-src 'self'",
    // React's development build needs eval for its debugging tools; production never does.
    `script-src 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https: ${app}`,
    `media-src 'self' https: ${app}`,
    "font-src 'self' data:",
    `connect-src 'self' ${app}`,
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://calendly.com",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self' ${app}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

const notFound = (requestId: string) => {
  const res = new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  res.headers.set("x-request-id", requestId);
  return res;
};

/**
 * A request to a tenant website host. Pages and the site's robots.txt and
 * sitemap.xml are rewritten to the internal /site-render route; the public
 * widget API passes through; everything else (the dashboard, /platform,
 * the private API) is a 404 on tenant hosts. `siteKey` is the subdomain.
 */
function tenantSite(request: NextRequest, siteKey: string, requestId: string, nonce: string): NextResponse {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  if (pathname.startsWith("/api/public/")) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("x-request-id", requestId);
    return res;
  }

  let target: string | null = null;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
    target = `/site-render/${siteKey}${pathname}`;
  } else {
    const slug = pathname.replace(/^\/+|\/+$/g, "");
    if (slug === "") target = `/site-render/${siteKey}`;
    else if (PAGE_SLUG_RE.test(slug) && !RESERVED_PAGE_SLUGS.has(slug.split("/")[0])) target = `/site-render/${siteKey}/${slug}`;
  }
  if (!target) return notFound(requestId);

  const csp = tenantCsp(nonce);
  // Next reads the nonce from the request's CSP header and adds it to its
  // own scripts; the site layout reads x-csp-nonce for the widget tag.
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-csp-nonce", nonce);
  requestHeaders.set("x-site-key", siteKey);
  const url = request.nextUrl.clone();
  url.pathname = target;
  const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

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

  const host = request.headers.get("host");
  const siteSubdomain = siteSubdomainFromHost(host);
  if (siteSubdomain) return tenantSite(request, siteSubdomain, requestId, nonce);
  // The bare sites domain, sites.<domain> (the CNAME target) and reserved
  // names under it serve nothing; the app never runs there.
  if (host && isSitesOnlyHost(host) && !pathname.startsWith("/api/public/")) return notFound(requestId);
  // The internal site renderer is only reachable through a tenant host.
  if (pathname === "/site-render" || pathname.startsWith("/site-render/")) return notFound(requestId);

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

  // The editor's preview page is framed by the dashboard (same origin).
  const pageCsp = pathname === "/site-preview" ? cspValue.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : cspValue;
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", pageCsp);
  return response;
}

export const config = {
  // robots.txt and sitemap.xml: tenant hosts serve their own.
  matcher: ["/((?!_next|.*\\..*).*)", "/api/:path*", "/robots.txt", "/sitemap.xml"],
};