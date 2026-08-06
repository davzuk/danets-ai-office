import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { getCsrfForCurrentSession } from "@/lib/csrf";

/**
 * POST /api/auth/refresh
 *
 * Walks the same `requireSession` path as any authenticated call:
 * validates the sliding window, rotates the token + CSRF if the prior
 * rotation is stale, updates lastSeenAt, then returns the fresh CSRF
 * cookie value to the client.
 *
 * The client calls this on a slow timer (just inside
 * `REFRESH_ROTATE_MINUTES`) so the foreground activity-driven rotation
 * stays cheap and the user gets an active session past the absolute cap
 * without ever re-logging in within the 7-day window.
 */
export function POST(_req: NextRequest) {
  return withSession(async () => {
    const csrf = await getCsrfForCurrentSession();
    return { ok: true, csrf };
  });
}
