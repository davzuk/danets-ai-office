import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { verifyTotpCode, consumeBackupCode } from "@/lib/totp";
import { ReauthRequiredError } from "@/lib/app-error";

/**
 * Fresh-credential gate for high-blast-radius actions.
 *
 * The audit flagged that `requireSession()` alone protects things like:
 *   - GDPR delete (now has its own password+TOTP check)
 *   - Payment verify (success path upgrades the subscription)
 *   - White-label config binding (custom domain + branding takeover)
 *   - Plan downgrade (revenue loss, quota reaping)
 *   - Super-admin password reset (account takeover)
 *
 * A stolen session cookie is enough to trigger any of these. We require a
 * "fresh credential" step — either the user's current password or a TOTP
 * code (or backup code) — within the last `REAUTH_WINDOW_MINUTES`. The
 * challenge is recorded as a short-lived cookie the privileged handler
 * checks on each call.
 *
 * The cookie is bound to the session ID so a stolen session cookie without
 * the reauth cookie is still rejected. We use `getSession()` to read the
 * server-side session ID and compare.
 */

export const REAUTH_COOKIE = "danets_reauth";
/** How long a fresh credential check is honoured. 5 minutes keeps the
 * friction low while still protecting against paste-replay of stolen cookies. */
export const REAUTH_WINDOW_MINUTES = 5;

interface ReauthSession {
  userId: string;
  sessionId: string;
}

/**
 * Throw `ReauthRequiredError` if the current request doesn't carry a valid
 * reauth marker for the current session within the freshness window.
 *
 * Use this as the first check inside any privileged handler — it must run
 * AFTER `requireSession()` (which establishes the session cookie) and
 * BEFORE the actual mutation.
 */
export async function requireReauth(
  session: ReauthSession,
  scope: "tenant" | "platform" = "tenant"
): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(REAUTH_COOKIE)?.value;
  if (!raw) {
    throw new ReauthRequiredError(
      "Please confirm your password or 2FA code to continue."
    );
  }

  const parsed = parseReauthMarker(raw);
  if (!parsed) {
    throw new ReauthRequiredError(
      "Reauthentication expired. Please confirm your password or 2FA code to continue."
    );
  }

  // The cookie must be bound to the *current* session — a reauth marker
  // minted on a different session can't be transplanted. Also reject
  // markers minted in the other scope (tenant <-> platform) — they
  // shouldn't be honoured in either direction.
  if (parsed.scope !== scope || parsed.sessionId !== session.sessionId) {
    throw new ReauthRequiredError(
      "Reauthentication expired. Please confirm your password or 2FA code to continue."
    );
  }

  const ageMs = Date.now() - parsed.at;
  if (ageMs > REAUTH_WINDOW_MINUTES * 60 * 1000) {
    throw new ReauthRequiredError(
      "Reauthentication expired. Please confirm your password or 2FA code to continue."
    );
  }
}

interface ReauthMarker {
  userId: string;
  sessionId: string;
  at: number;
  /** "tenant" vs "platform" — distinguishes which session table the marker
   * is bound to. Prevents a tenant reauth marker being honoured against a
   * platform session that happens to share the same userId. */
  scope: "tenant" | "platform";
}

/**
 * Parse a reauth cookie. The format is `userId|sessionId|at|scope` — we
 * keep the shape simple because the cookie carries no secret of its own.
 * The session ID is the secret: only the row matching that session ID
 * will accept the marker in `requireReauth`.
 */
function parseReauthMarker(raw: string): ReauthMarker | null {
  const parts = raw.split("|");
  if (parts.length !== 4) return null;
  const [userId, sessionId, atStr, scope] = parts;
  const at = Number(atStr);
  if (!userId || !sessionId || !Number.isFinite(at)) return null;
  if (scope !== "tenant" && scope !== "platform") return null;
  return { userId, sessionId, at, scope };
}

/**
 * Mint a reauth cookie after a successful fresh-credential check.
 *
 * - `sessionId` is the row ID of the active session (tenant Session.id or
 *   platform PlatformSession.id) — the cookie is bound to it.
 * - `scope` distinguishes tenant vs platform markers so a tenant marker
 *   can never be replayed against a platform session (or vice versa).
 */
async function issueReauthCookie(
  userId: string,
  sessionId: string,
  scope: "tenant" | "platform"
): Promise<void> {
  const at = Date.now();
  const raw = `${userId}|${sessionId}|${at}|${scope}`;
  const cookieStore = await cookies();
  cookieStore.set(REAUTH_COOKIE, raw, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: REAUTH_WINDOW_MINUTES * 60,
  });
}

/**
 * Verify a fresh credential presented by a *tenant* user (`BusinessUser`)
 * and (on success) issue a reauth cookie that downstream handlers will
 * accept via `requireReauth`.
 *
 * Accepted challenges:
 *   - `currentPassword` — must match the user's stored hash
 *   - `totpCode` — verified against the user's TOTP secret OR backup codes
 *
 * At least one MUST be present and correct. Both are accepted together
 * so a user with 2FA off can satisfy the gate with a password alone.
 *
 * Throws `ReauthRequiredError` on failure (so the calling route handler
 * can surface the same 401 + code the helper produces).
 */
export async function verifyFreshCredential(
  session: ReauthSession,
  challenge: { currentPassword?: string; totpCode?: string }
): Promise<{ id: string; email: string; totpEnabled: boolean }> {
  const user = await db.businessUser.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      password: true,
      totpEnabled: true,
      totpSecret: true,
      totpBackupCodes: true,
    },
  });
  if (!user) {
    throw new ReauthRequiredError("Account not found.");
  }

  await checkCredential(
    {
      passwordHash: user.password,
      totpEnabled: user.totpEnabled,
      totpSecret: user.totpSecret,
      backupCodes: (user.totpBackupCodes as string[] | null) ?? null,
      // businessUserId is unused unless we have backup codes — passed
      // through so consumeBackupCode can update the right row.
      businessUserId: user.id,
    },
    challenge
  );

  if (!session.sessionId) {
    // Defensive: callers should always pass a session ID. Without it we
    // can't bind the cookie to a session, so refuse to issue one.
    throw new ReauthRequiredError(
      "Reauthentication requires an active session."
    );
  }

  await issueReauthCookie(user.id, session.sessionId, "tenant");
  return {
    id: user.id,
    email: user.email,
    totpEnabled: user.totpEnabled,
  };
}

/**
 * Verify a fresh credential for a *platform* admin (`PlatformAdmin`).
 * Same flow as `verifyFreshCredential` but bound to the platform session
 * and the PlatformAdmin row. Used by super-admin password reset.
 */
export async function verifyPlatformFreshCredential(
  platformAdminId: string,
  platformSessionId: string,
  challenge: { currentPassword?: string; totpCode?: string }
): Promise<{ id: string; email: string; totpEnabled: boolean }> {
  const admin = await db.platformAdmin.findUnique({
    where: { id: platformAdminId },
    select: {
      id: true,
      email: true,
      password: true,
      totpEnabled: true,
      totpSecret: true,
    },
  });
  if (!admin) {
    throw new ReauthRequiredError("Platform admin not found.");
  }

  await checkCredential(
    {
      passwordHash: admin.password,
      totpEnabled: admin.totpEnabled,
      totpSecret: admin.totpSecret,
      backupCodes: null,
      // Platform admins don't have backup-code consumption in the same
      // way (consumeBackupCode targets BusinessUser). The TODO is to
      // mirror the helper for PlatformAdmin; until then we don't accept
      // backup codes here.
      businessUserId: null,
    },
    challenge
  );

  await issueReauthCookie(admin.id, platformSessionId, "platform");
  return {
    id: admin.id,
    email: admin.email,
    totpEnabled: admin.totpEnabled,
  };
}

interface CredentialTarget {
  passwordHash: string | null;
  totpEnabled: boolean;
  totpSecret: string | null;
  backupCodes: string[] | null;
  businessUserId: string | null;
}

/**
 * Shared verification: password OR totpCode must match. Both can be
 * supplied; either matching is enough, but a wrong one is fatal (so
 * a typo in either field fails the whole check).
 */
async function checkCredential(
  target: CredentialTarget,
  challenge: { currentPassword?: string; totpCode?: string }
): Promise<void> {
  let passwordOk = false;
  if (challenge.currentPassword) {
    if (!target.passwordHash) {
      throw new ReauthRequiredError("Password is not set on this account.");
    }
    passwordOk = await bcrypt.compare(challenge.currentPassword, target.passwordHash);
    if (!passwordOk) {
      throw new ReauthRequiredError("Current password is incorrect.");
    }
  }

  let totpOk = false;
  if (challenge.totpCode) {
    if (!target.totpEnabled) {
      throw new ReauthRequiredError("2FA is not enabled on this account.");
    }
    if (target.totpSecret) {
      totpOk = await verifyTotpCode(target.totpSecret, challenge.totpCode);
    }
    if (!totpOk && target.backupCodes && target.businessUserId) {
      totpOk = await consumeBackupCode(
        db,
        target.businessUserId,
        challenge.totpCode
      );
    }
    if (!totpOk) {
      throw new ReauthRequiredError("Invalid 2FA code.");
    }
  }

  if (!passwordOk && !totpOk) {
    throw new ReauthRequiredError(
      "Please provide your current password or a valid 2FA code."
    );
  }
}

/**
 * Clear any reauth cookie (called on logout / session destruction so the
 * next session starts in the "reauth required" state).
 */
export async function clearReauthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(REAUTH_COOKIE, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
