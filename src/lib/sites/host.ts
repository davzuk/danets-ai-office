// Tenant site hosts. Pure and edge-safe: the middleware imports this.
//
// Tenant sites live on <subdomain>.SITES_DOMAIN, a registrable domain that
// is separate from the app's (e.g. danets.site next to app.danets.com), so
// app cookies never reach tenant pages. SITES_DOMAIN may carry a port for
// local development; without it, development falls back to localhost
// subdomains (acme.localhost:3000 resolves to 127.0.0.1 in browsers).

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** Subdomains a tenant can't take: ours, or ones that look official. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "platform", "mail", "email", "smtp", "imap", "pop", "ftp",
  "sites", "site", "static", "assets", "cdn", "media", "files", "img", "images",
  "danets", "support", "help", "blog", "status", "docs", "dashboard", "login", "auth",
  "account", "accounts", "billing", "pay", "payments", "secure", "ns1", "ns2", "dns",
  "test", "dev", "staging", "preview", "demo", "localhost",
]);

type Env = Record<string, string | undefined>;

/** The sites domain (lowercase, may include a port), or null when sites aren't served. */
export function sitesDomain(env: Env = process.env): string | null {
  const raw = env.SITES_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (raw) return raw;
  if (env.NODE_ENV === "production") return null;
  // Development: tenant sites on localhost subdomains, same port as the app.
  try {
    const app = new URL(env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
    return app.hostname === "localhost" ? `localhost${app.port ? `:${app.port}` : ""}` : null;
  } catch {
    return null;
  }
}

/** http in development on localhost, https everywhere else. */
function sitesProtocol(domain: string): "http:" | "https:" {
  const hostname = domain.replace(/:\d+$/, "");
  return hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
}

/** The subdomain a Host header points at, or null when it isn't a tenant site host. */
export function siteSubdomainFromHost(host: string | null | undefined, env: Env = process.env): string | null {
  const domain = sitesDomain(env);
  if (!host || !domain) return null;
  const h = host.trim().toLowerCase();
  const suffix = `.${domain}`;
  if (!h.endsWith(suffix)) return null;
  const sub = h.slice(0, -suffix.length);
  return SUBDOMAIN_RE.test(sub) && !RESERVED_SUBDOMAINS.has(sub) ? sub : null;
}

/** The public origin of a tenant site. */
export function siteOrigin(subdomain: string, env: Env = process.env): string | null {
  const domain = sitesDomain(env);
  if (!domain) return null;
  return `${sitesProtocol(domain)}//${subdomain}.${domain}`;
}

/** Why a subdomain can't be used, or null when it's fine. */
export function subdomainProblem(sub: string): string | null {
  if (!SUBDOMAIN_RE.test(sub)) return "Use 3 to 32 lowercase letters, numbers or hyphens, starting and ending with a letter or number.";
  if (RESERVED_SUBDOMAINS.has(sub)) return "That address is reserved. Choose another.";
  return null;
}

/** A starting subdomain from a business name. */
export function suggestSubdomain(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  const candidate = base.length >= 3 ? base : `${base || "site"}-site`;
  return RESERVED_SUBDOMAINS.has(candidate) ? `${candidate}-co` : candidate;
}

/** Page slugs: "" for the home page, or up to 3 segments like "services/roofing". */
export const PAGE_SLUG_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?)(?:\/[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?){0,2}$/;

/** Paths a page can't use because the site serves them itself. */
export const RESERVED_PAGE_SLUGS = new Set(["robots.txt", "sitemap.xml", "api", "_next", "favicon.ico"]);

// ─── Custom domains ─────────────────────────────────────────────────

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

const stripPort = (host: string) => host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");

/** The sites domain without a port ("danets.site", or "localhost" in development). */
export function sitesHostname(env: Env = process.env): string | null {
  const d = sitesDomain(env);
  return d ? stripPort(d) : null;
}

/**
 * Hostnames that serve the app itself: NEXT_PUBLIC_APP_URL's, any in
 * APP_HOSTS (comma-separated, e.g. "danets.com,www.danets.com") and loopback.
 * Everything else that reaches the server is treated as a tenant's domain.
 */
export function appHostnames(env: Env = process.env): Set<string> {
  const out = new Set(LOOPBACK_HOSTS);
  try {
    out.add(new URL(env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").hostname.toLowerCase());
  } catch {
    // ignore a malformed URL; loopback still works
  }
  for (const h of (env.APP_HOSTS ?? "").split(",")) {
    const v = stripPort(h);
    if (v) out.add(v);
  }
  return out;
}

/** True for the sites domain itself and anything under it (tenant subdomains included). */
export function isUnderSitesDomain(host: string, env: Env = process.env): boolean {
  const base = sitesHostname(env);
  if (!base) return false;
  const h = stripPort(host);
  if (h === base) return true;
  if (!h.endsWith(`.${base}`)) return false;
  // Development: only <sub>.localhost is ours, so deeper names like
  // www.acme.localhost (which browsers also send to 127.0.0.1) can stand
  // in for a tenant's own domain.
  if (base === "localhost") return !h.slice(0, -".localhost".length).includes(".");
  return true;
}

/**
 * Hosts under the sites domain that aren't a tenant site: the bare domain,
 * sites.<domain> (the CNAME target) and reserved names. They serve nothing.
 * An app hostname is never one (in development both are "localhost").
 */
export function isSitesOnlyHost(host: string, env: Env = process.env): boolean {
  return isUnderSitesDomain(host, env) && !appHostnames(env).has(stripPort(host)) && !siteSubdomainFromHost(host, env);
}

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$`);

/** What a tenant typed ("https://WWW.Acme.com/about") as a bare hostname ("www.acme.com"). */
export function normalizeCustomDomain(raw: string): string {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = v.split(/[/?#]/)[0];
  return stripPort(v);
}

/** Why a domain can't be connected, or null when it can. */
export function customDomainProblem(domain: string, env: Env = process.env): string | null {
  if (domain.length > 191 || !DOMAIN_RE.test(domain)) return "Enter a domain like www.example.com.";
  if (isUnderSitesDomain(domain, env)) return "That's already a Danets address. Enter your own domain.";
  if (appHostnames(env).has(domain)) return "That domain belongs to the platform.";
  if (env.NODE_ENV === "production" && (domain.endsWith(".localhost") || domain.endsWith(".local") || domain.endsWith(".test") || domain.endsWith(".internal"))) {
    return "Use a public domain you own.";
  }
  return null;
}

/**
 * The custom domain a Host header could be, or null when it's the app, a
 * Danets sites address, or not a domain at all. Whether it's actually
 * connected to a site is decided by the renderer (a database lookup).
 */
export function customDomainFromHost(host: string | null | undefined, env: Env = process.env): string | null {
  if (!host || !sitesDomain(env)) return null;
  const h = stripPort(host);
  if (appHostnames(env).has(h) || isUnderSitesDomain(h, env)) return null;
  return DOMAIN_RE.test(h) ? h : null;
}

/** https in production; in development the app's protocol and port, so hosts-file domains work. */
export function customDomainOrigin(domain: string, env: Env = process.env): string {
  if (env.NODE_ENV === "production") return `https://${domain}`;
  try {
    const app = new URL(env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
    return `${app.protocol}//${domain}${app.port ? `:${app.port}` : ""}`;
  } catch {
    return `http://${domain}`;
  }
}

/** Where tenants point their domain: a CNAME to sites.<SITES_DOMAIN>. */
export function domainCnameTarget(env: Env = process.env): string | null {
  const base = sitesHostname(env);
  return base ? `sites.${base}` : null;
}

/** The TXT record name that proves ownership. */
export const domainTxtName = (domain: string) => `_danets.${domain}`;
