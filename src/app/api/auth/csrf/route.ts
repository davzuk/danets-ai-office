import { NextResponse } from "next/server";
import { mintAnonymousCsrfCookie } from "@/lib/csrf";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * GET /api/auth/csrf — mints a pre-authentication CSRF cookie so the
 * browser can issue state-changing requests to endpoints like
 * /api/auth/forgot-password and /api/auth/reset-password without being
 * vulnerable to cross-site form forgery.
 *
 * The cookie is `sameSite=strict` so cross-origin POSTs from an attacker
 * site won't carry it. The cookie value is also echoed back via the
 * x-csrf-token header on the actual mutating request, and the server
 * compares them in constant time (see `verifyAnonymousCsrf` in
 * src/lib/csrf.ts).
 *
 * Rate-limited per IP to keep an attacker from forcing repeated
 * cookie rotations on the victim. Logged-out browsers may cache the
 * cookie for the duration of a password-reset flow.
 */
export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`csrf-bootstrap:${ip}`, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429 }
    );
  }

  const csrf = await mintAnonymousCsrfCookie();
  return NextResponse.json({ csrf });
}