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
  "/api/public/",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/forgot",
  "/api/auth/reset",
  "/api/auth/csrf",
  "/api/auth/totp/", // session already gated; TOTP endpoints use a different model
  "/api/platform-auth/",
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
