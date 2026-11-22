// CORS for the public widget API (/api/public/chat, /lead, /track, /widget).
//
// The widget runs on tenants' own websites, so these routes are called
// cross-origin. They never use cookies, so responses allow the caller's
// origin without credentials. A tenant can lock its public key to its own
// domains (Business.widgetAllowedOrigins); calls from any other website are
// refused, which stops a copied key from running the bot (and spending the
// tenant's AI quota) somewhere else. Requests with no Origin header (same
// origin GETs, server-side callers) are let through: the lock is a browser
// control, and anything outside a browser can fake the header anyway.

import { NextRequest, NextResponse } from "next/server";
import { logger, serializeError } from "@/lib/logger";

export const MAX_ALLOWED_ORIGINS = 20;

/**
 * Normalise one entry typed by a tenant into a host pattern:
 * "https://www.Example.com/contact" → "example.com" (which also covers www.),
 * "*.example.com" stays a wildcard, "localhost:8080" keeps its port.
 * Returns null for anything that isn't a plausible host.
 */
export function normalizeOriginEntry(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const wildcard = s.startsWith("*.");
  const rest = wildcard ? s.slice(2) : s;
  let host: string;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(rest) ? rest : `https://${rest}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
  const hostname = host.replace(/:\d+$/, "");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
  if (!isIp && hostname !== "localhost" && !/^([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(hostname)) return null;
  if (wildcard && (isIp || hostname === "localhost")) return null;
  if (wildcard) return `*.${host}`;
  // "www.example.com" is stored as "example.com", which covers both, so a
  // tenant who pastes their www address doesn't lock out the bare domain.
  return host.startsWith("www.") && host.split(".").length > 2 ? host.slice(4) : host;
}

/** Clean, dedupe and cap a list typed by the tenant. */
export function normalizeOriginList(entries: string[]): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const e of entries) {
    if (!e.trim()) continue;
    const n = normalizeOriginEntry(e);
    if (!n) invalid.push(e.trim());
    else if (!origins.includes(n)) origins.push(n);
  }
  return { origins: origins.slice(0, MAX_ALLOWED_ORIGINS), invalid };
}

/** The stored JSON as a list; anything malformed counts as "no lock". */
export function readAllowedOrigins(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function hostOfOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
}

/**
 * Whether a browser Origin may use this tenant's widget. An empty list
 * means any website. "example.com" also covers "www.example.com";
 * "*.example.com" covers every subdomain and the bare domain.
 */
export function isOriginAllowed(origin: string, allowed: string[], appOrigin?: string): boolean {
  if (allowed.length === 0) return true;
  if (appOrigin && origin === appOrigin) return true; // the dashboard preview and widget demo
  const host = hostOfOrigin(origin);
  if (!host) return false;
  return allowed.some((entry) => {
    if (entry.startsWith("*.")) {
      const base = entry.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === entry || host === `www.${entry}`;
  });
}

export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** The preflight answer. The origin check happens on the real request, once the tenant is known. */
export function publicPreflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

/**
 * Wrap a public route handler so every response carries CORS headers,
 * including a crash: without them the widget can't even read the 500.
 */
export function withPublicCors(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      logger.error("Public API request failed", { path: req.nextUrl.pathname, ...serializeError(e) });
      res = NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
    for (const [k, v] of Object.entries(corsHeaders(req.headers.get("origin")))) res.headers.set(k, v);
    return res;
  };
}

/**
 * The 403 to return when the calling website isn't on the tenant's list,
 * or null when the call may go ahead.
 */
export function blockedOrigin(req: NextRequest, allowedOrigins: unknown): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (isOriginAllowed(origin, readAllowedOrigins(allowedOrigins), appOrigin())) return null;
  return NextResponse.json({ error: "This website isn't allowed to use this chat widget.", code: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
}

/** Page the visitor is on, as sent by the widget: origin + path and a short one-line title. */
export function readPageContext(raw: unknown): { url: string; title: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { url?: unknown; title?: unknown };
  if (typeof r.url !== "string") return null;
  let url: string;
  try {
    const u = new URL(r.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    url = (u.origin + u.pathname).slice(0, 500);
  } catch {
    return null;
  }
  const title =
    typeof r.title === "string"
      ? r.title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || null
      : null;
  return { url, title };
}

/**
 * blockedOrigin, plus the tenant's own website (<subdomain>.SITES_DOMAIN, or
 * its verified custom domain), which can always run its chat widget even
 * when the tenant has locked the key to other domains.
 */
export async function blockedOriginFor(req: NextRequest, business: { id: string; widgetAllowedOrigins: unknown }): Promise<NextResponse | null> {
  const blocked = blockedOrigin(req, business.widgetAllowedOrigins);
  if (!blocked) return null;
  try {
    const { customDomainFromHost, siteSubdomainFromHost } = await import("@/lib/sites/host");
    const host = new URL(req.headers.get("origin") ?? "").host;
    const sub = siteSubdomainFromHost(host);
    const domain = sub ? null : customDomainFromHost(host);
    if (sub || domain) {
      const { db } = await import("@/lib/db");
      const site = await db.tenantSite.findUnique({
        where: sub ? { subdomain: sub } : { customDomain: domain! },
        select: { businessId: true, domainStatus: true },
      });
      if (site?.businessId === business.id && (sub || site.domainStatus === "verified")) return null;
    }
  } catch {
    // Not a URL, or the lookup failed: keep the refusal.
  }
  return blocked;
}
