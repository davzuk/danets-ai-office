import { createHash, randomBytes } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";

// Single source of truth for the TOTP issuer shown in authenticator apps.
// Must match across setup + verify so users don't see two different labels
// for the same account.
export const TOTP_ISSUER_TENANT = "Danets AI Automation";
export const TOTP_ISSUER_PLATFORM = "Danets Platform Admin";

export function generateTotpSecret() {
  return generateSecret();
}

export function getTotpUri(
  email: string,
  secret: string,
  issuer: string = TOTP_ISSUER_TENANT
) {
  return generateURI({
    issuer,
    label: email,
    secret,
  });
}

export async function verifyTotpCode(secret: string, code: string) {
  const result = await verify({
    token: code.replace(/\s/g, ""),
    secret,
  });
  return result.valid;
}

/**
 * Generate a batch of single-use backup codes. Each code is 8 hex chars
 * (uppercased) — enough entropy that brute force is impractical given
 * one-shot consumption. Codes are stored as SHA-256 hashes; the cleartext
 * is only returned to the user once, immediately after generation.
 */
export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () =>
    randomBytes(4).toString("hex").toUpperCase()
  );
}

/**
 * Normalize + hash a backup code for storage and lookup comparison.
 * The cleartext is uppercased and whitespace-stripped before hashing so
 * the same code pasted in any casing or with spaces still matches.
 */
export function hashBackupCode(code: string) {
  const normalized = code.replace(/\s/g, "").toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Look up a backup code against the user's stored hashes, and remove the
 * matched code in a single transaction so concurrent attempts cannot
 * double-consume the same code. Returns `true` on a successful consume,
 * `false` if the code is unknown / already used / malformed.
 *
 * `db` must be the Prisma client (`db.$transaction` is used internally).
 */
export async function consumeBackupCode(
  db: { $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T> },
  businessUserId: string,
  code: string
) {
  // Cheap format check first so an obvious gibberish string doesn't round-trip
  // through the transaction. Backup codes are 8 hex chars.
  const cleaned = code.replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(cleaned)) return false;

  const target = hashBackupCode(cleaned);

  return db.$transaction(async (tx) => {
    const user = await tx.businessUser.findUnique({
      where: { id: businessUserId },
      select: { totpBackupCodes: true },
    });
    const hashes = (user?.totpBackupCodes as string[] | null) ?? [];
    const idx = hashes.indexOf(target);
    if (idx === -1) return false;

    const next = hashes.filter((_, i) => i !== idx);
    await tx.businessUser.update({
      where: { id: businessUserId },
      data: { totpBackupCodes: next as any },
    });
    return true;
  });
}
