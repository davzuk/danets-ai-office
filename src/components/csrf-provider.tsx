"use client";

import { useEffect } from "react";

/**
 * Mounts a global `window.fetch` interceptor that automatically attaches the
 * CSRF token to every state-changing request.
 *
 * The token is read from the non-httpOnly `danets_csrf` cookie that the
 * server sets when issuing a session. The server-side `verifyCsrf()` in
 * `src/lib/auth.ts` then compares the header value against the cookie value
 * AND against the token persisted on the `Session` row.
 *
 * Also schedules a slow background refresh ping to `/api/auth/refresh`
 * every 14 minutes — slightly inside the server-side
 * `REFRESH_ROTATE_MINUTES` so the foreground path (which only refreshes
 * after 15 min of inactivity) stays cheap. The refresh endpoint rotates
 * the session token + CSRF token via `requireSession` and the
 * danets_csrf cookie is rewritten in the response.
 *
 * Safe-by-default: only mutating methods (POST/PUT/PATCH/DELETE) get the
 * header, and only when a danets_csrf cookie is present. Pass-through for
 * all other requests.
 */
export function CsrfProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetch = window.fetch.bind(window);
    const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

    // P10: kick off a periodic session refresh so the absolute cap doesn't
    // kick in for active users. 14 min < REFRESH_ROTATE_MINUTES (15 min).
    const REFRESH_INTERVAL_MS = 14 * 60 * 1000;
    const refreshTimer = window.setInterval(() => {
      // Skip if the tab is hidden — no need to renew while the user is away.
      if (document.visibilityState !== "visible") return;
      originalFetch("/api/auth/refresh", { method: "POST" }).catch(() => {
        // Network blip or signed out — silent retry on next tick.
      });
    }, REFRESH_INTERVAL_MS);

    function readCookie(name: string): string | null {
      const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${name}=`));
      return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
    }

    window.fetch = function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      try {
        const method = (
          (init?.method as string | undefined) ??
          (typeof input === "object" && "method" in input
            ? (input as Request).method
            : "GET")
        ).toUpperCase();

        if (!UNSAFE_METHODS.has(method)) {
          return originalFetch(input as any, init as any);
        }

        const csrf = readCookie("danets_csrf");
        if (!csrf) {
          // No CSRF cookie — let the request fail loudly on the server.
          return originalFetch(input as any, init as any);
        }

        const headers = new Headers(init?.headers);
        if (!headers.has("x-csrf-token")) {
          headers.set("x-csrf-token", csrf);
        }

        const next: RequestInit = { ...init, headers, method };
        return originalFetch(input as any, next as any);
      } catch {
        return originalFetch(input as any, init as any);
      }
    };

    return () => {
      window.clearInterval(refreshTimer);
      window.fetch = originalFetch;
    };
  }, []);

  return <>{children}</>;
}
