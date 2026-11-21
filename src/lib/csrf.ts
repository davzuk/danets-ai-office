import { cookies, headers } from "next/headers";
import { randomBytes, timingSafeEqual } from "crypto";

export const CSRF_COOKIE = "danets_csrf";
export const CSRF_HEADER = "x-csrf-token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that must be reachable from third-party origins without a CSRF
 * token. Each entry is matched as a prefix on the request pathname.
 *
 *   - Provider-signed webhooks validate via signature headers (HMAC SHA512,
 *     verif-hash) and would fail any CSRF check otherwise.
 *   - Public widget/auth/platform-auth endpoints are unauthenticated; their
 *     own rate-limits and (for the widget) origin checks are sufficient.
 */
const EXEMPT_PATH_PREFIXES = [
  "/api/payments/webhook",
  "/api/whatsapp/incoming",
  "/api/webhooks/", // provider webhooks: authenticated by signature, no session
  "/api/public/",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/csrf",
  "/api/auth/totp/", // session already gated; TOTP endpoints use a different model
  "/api/platform-auth/",
  // forgot-password and reset-password enforce CSRF via
  // verifyAnonymousCsrf() — the cookie is minted by /api/auth/csrf
  // and the bootstrap is required before these endpoints will accept
  // a request. They don't appear here.
];

export function isCsrfExempt(pathname: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Issue a new CSRF token, persist it on the session row, and set a
 * non-httpOnly cookie so the browser can echo it back via header.
 *
 * Called once per login / impersonation event.
 */
export async function ensureCsrfForSession(
  sessionId: string,
  expiresAt: Date
): Promise<string> {
  const { db } = await import("@/lib/db");
  const csrf = generateToken();
  await db.session.update({
    where: { id: sessionId },
    data: { csrfToken: csrf },
  });
  const cookieStore = await cookies();
  cookieStore.set(CSRF_COOKIE, csrf, {
    httpOnly: false, // browser JS must be able to read this
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  return csrf;
}

/**
 * Returns the CSRF token that the browser should send back, or null if
 * no session cookie is present. Useful for client bootstrap endpoints.
 */
export async function getCsrfForCurrentSession(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CSRF_COOKIE)?.value ?? null;
}

/**
 * Mint a pre-authentication CSRF token for anonymous flows (forgot-password,
 * reset-password, register) that need to issue a mutating request before a
 * session exists. The cookie value is the source of truth — there's no
 * DB row to bind it to yet. `verifyCsrfAnonymous` checks that the header
 * echoes this cookie when no session is present.
 *
 * The cookie is `sameSite=strict` so the browser only attaches it on
 * same-site navigations, which is the additional layer that defeats
 * cross-site form-POST CSRF on top of the header check.
 */
export async function mintAnonymousCsrfCookie(): Promise<string> {
  const token = generateToken();
  const cookieStore = await cookies();
  // 1 hour — long enough for a user to fill out a password reset form,
  // short enough that stale cookies don't accumulate.
  cookieStore.set(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60,
  });
  return token;
}

/**
 * Verify a state-changing request carries a matching CSRF token.
 *
 * Must be invoked AFTER getSession() / requireSession() so the session
 * row can be looked up by its DB-side csrfToken.
 *
 * Returns silently on success; throws "CSRF_INVALID" otherwise.
 */
export async function verifyCsrf(
  dbCsrfToken: string | null
): Promise<void> {
  const h = await headers();
  const method = (h.get("x-danets-method") || "GET").toUpperCase();
  const pathname = h.get("x-danets-pathname") || "";

  if (!UNSAFE_METHODS.has(method)) return;
  if (isCsrfExempt(pathname)) return;

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;
  const headerToken =
    h.get(CSRF_HEADER) ||
    h.get("x-xsrf-token") ||
    h.get("csrf-token");

  if (!cookieToken || !headerToken || !dbCsrfToken) {
    throw new Error("CSRF_INVALID");
  }
  if (!constantTimeEqual(cookieToken, headerToken)) {
    throw new Error("CSRF_INVALID");
  }
  if (!constantTimeEqual(cookieToken, dbCsrfToken)) {
    throw new Error("CSRF_INVALID");
  }
}

/**
 * Verify a CSRF token on an anonymous (pre-auth) request — for the
 * /api/auth/forgot-password and /api/auth/reset-password endpoints. There
 * is no DB row yet, so we only check that the header echoes the cookie
 * value. The cookie is `sameSite=strict`, which gives the second layer.
 *
 * Throws "CSRF_INVALID" on mismatch.
 */
export async function verifyAnonymousCsrf(): Promise<void> {
  const h = await headers();
  const method = (h.get("x-danets-method") || "GET").toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return;

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;
  const headerToken =
    h.get(CSRF_HEADER) ||
    h.get("x-xsrf-token") ||
    h.get("csrf-token");

  if (!cookieToken || !headerToken) {
    throw new Error("CSRF_INVALID");
  }
  if (!constantTimeEqual(cookieToken, headerToken)) {
    throw new Error("CSRF_INVALID");
  }
}
