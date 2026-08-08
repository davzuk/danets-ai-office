/**
 * Centralized CRON_SECRET checks.
 *
 * The audit flagged that a short `CRON_SECRET` makes bearer-token brute
 * force trivial. The minimum length is 32 chars (256 bits of entropy
 * once base64-decoded; well above the 128-bit threshold for secrets).
 *
 * Two checks are provided:
 *   - `assertCronSecretConfig()`: called at module load (startup-time)
 *     so an operator who boots the app with a short / missing secret
 *     gets a loud failure rather than silent 503s on every cron call.
 *   - `verifyCronRequest(req)`: per-request check that combines the
 *     length guard (defensive — operator might rotate to a short
 *     secret at runtime) with constant-time bearer comparison.
 */

const MIN_CRON_SECRET_LENGTH = 32;

let cachedWarning: string | null = null;

/**
 * Run once on module import. Warns loudly if CRON_SECRET is missing or
 * too short; does NOT throw, because the cron endpoint should still
 * be reachable enough to return a 503 (and you may want to deploy the
 * code before setting the secret). The warning is logged through the
 * shared structured logger.
 */
export async function assertCronSecretConfig(): Promise<void> {
  // De-dupe — Next.js can re-import this module across routes.
  if (cachedWarning) return;

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    cachedWarning = "missing";
    const { logger } = await import("@/lib/logger");
    logger.error(
      "CRON_SECRET is not set — /api/cron/* endpoints will reject all calls until it's configured (min 32 chars)."
    );
    return;
  }
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    cachedWarning = "short";
    const { logger } = await import("@/lib/logger");
    logger.error(
      `CRON_SECRET is too short (${secret.length} chars; minimum ${MIN_CRON_SECRET_LENGTH}) — brute force is feasible. /api/cron/* endpoints will refuse to run.`
    );
    return;
  }
  cachedWarning = "ok";
}

/**
 * Per-request cron check. Returns either `{ ok: true }` or a `NextResponse`
 * the caller should return directly.
 *
 * Side effect: runs `assertCronSecretConfig()` once so the per-request
 * check stays self-contained — no separate boot hook required.
 */
export async function verifyCronRequest(
  req: Request
): Promise<{ ok: true } | { ok: false; response: Response }> {
  await assertCronSecretConfig();

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      response: Response.json(
        { error: "CRON_SECRET is not configured on this server" },
        { status: 503 }
      ),
    };
  }
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    return {
      ok: false,
      response: Response.json(
        { error: "CRON_SECRET too short" },
        { status: 503 }
      ),
    };
  }

  const { timingSafeEqual } = await import("crypto");
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = new TextEncoder().encode(auth);
  const b = new TextEncoder().encode(expected);
  // Refuse on length mismatch before timingSafeEqual — that's a known
  // shape of timing leak the constant-time check would otherwise expose.
  if (a.length !== b.length) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  try {
    if (!timingSafeEqual(a, b)) {
      return {
        ok: false,
        response: Response.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}
