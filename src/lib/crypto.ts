import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "crypto";

/**
 * Envelope encryption for integration API keys (and any other sensitive
 * JSON-stored secret we want to keep out of plaintext at rest).
 *
 * Format on disk (a JSON object stored inside the existing `config` text
 * column of `Integration` and `WhatsAppIntegration`):
 *
 *   {
 *     "__enc": 1,
 *     "v": 1,
 *     "ciphertext": "<base64>",
 *     "iv": "<base64>",
 *     "tag": "<base64>"
 *   }
 *
 * The `__enc` discriminator lets us tell legacy plaintext rows from new
 * encrypted rows without a one-shot migration script — when the read path
 * sees a plaintext object, it transparently re-encrypts in place.
 *
 * Key management: a single 32-byte AES-256 key derived from
 * `INTEGRATION_ENCRYPTION_KEY` (32 random bytes, base64-encoded). The dev
 * environment uses a fixed fallback so the codebase still boots without
 * setup; production refuses to start without the env var.
 */

const ALGO: CipherGCMTypes = "aes-256-gcm";
const ENC_VERSION = 1;
const ENC_DISCRIMINATOR = "__enc" as const;

export type EncryptedPayload = {
  [ENC_DISCRIMINATOR]: 1;
  v: typeof ENC_VERSION;
  ciphertext: string;
  iv: string;
  tag: string;
};

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (env && env.length > 0) {
    const buf = Buffer.from(env, "base64");
    if (buf.length !== 32) {
      throw new Error(
        "INTEGRATION_ENCRYPTION_KEY must be exactly 32 bytes (base64-encoded)"
      );
    }
    cachedKey = buf;
    return cachedKey;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is required in production (32 random bytes, base64-encoded)"
    );
  }
  // Dev fallback — deterministic so unit tests and dev restarts don't lose
  // access to previously-encrypted rows. NEVER use this in production.
  cachedKey = Buffer.alloc(32, 7);
  return cachedKey;
}

/**
 * Reset the cached key. Used by tests that swap
 * `INTEGRATION_ENCRYPTION_KEY` mid-suite. Not for production code paths.
 */
export function __resetCryptoKeyForTests(): void {
  cachedKey = null;
}

/**
 * Encrypt a plaintext string into the on-disk envelope shape.
 * Returns the same object form regardless of the input length — callers
 * persist it by JSON.stringify-ing the value into the existing `config`
 * column (or any other JSON-shaped column).
 */
export function encryptApiKey(plaintext: string): EncryptedPayload {
  const key = loadKey();
  const iv = randomBytes(12); // GCM standard nonce size
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    [ENC_DISCRIMINATOR]: 1,
    v: ENC_VERSION,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Reverse of `encryptApiKey`. Returns `null` if the input isn't a recognized
 * encrypted envelope so callers can detect legacy plaintext rows.
 */
export function decryptApiKey(payload: unknown): string | null {
  if (!isEncryptedPayload(payload)) return null;
  if (payload.v !== ENC_VERSION) return null;
  try {
    const key = loadKey();
    const decipher = createDecipheriv(
      ALGO,
      key,
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return plaintext;
  } catch {
    return null;
  }
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v[ENC_DISCRIMINATOR] === 1 &&
    typeof v.ciphertext === "string" &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.v === "number"
  );
}

/**
 * Mask helper used by API responses so the cleartext never leaves the server
 * even after a successful decrypt. Format: first 4 + bullet run + last 4.
 * Falls back to bullets-only for short strings.
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}