import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "crypto";
import {
  __resetCryptoKeyForTests,
  decryptApiKey,
  encryptApiKey,
  isEncryptedPayload,
  maskApiKey,
} from "@/lib/crypto";

afterEach(() => {
  // Reset the cached key between tests so an env swap in one test doesn't
  // leak into the next. Tests that don't touch the env still pass — the
  // reset is a no-op when nothing is cached.
  __resetCryptoKeyForTests();
});

describe("encryptApiKey / decryptApiKey", () => {
  it("round-trips a known plaintext", () => {
    const plaintext = "sk-test-1234567890abcdef";
    const envelope = encryptApiKey(plaintext);
    expect(decryptApiKey(envelope)).toBe(plaintext);
  });

  it("round-trips unicode and emoji safely", () => {
    const plaintext = "naïve-ключ-🔐";
    const envelope = encryptApiKey(plaintext);
    expect(decryptApiKey(envelope)).toBe(plaintext);
  });

  it("is non-deterministic — IV changes on every call", () => {
    const plaintext = "sk-test-1";
    const a = encryptApiKey(plaintext);
    const b = encryptApiKey(plaintext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.tag).not.toBe(b.tag);
    // But both still decrypt to the same plaintext.
    expect(decryptApiKey(a)).toBe(plaintext);
    expect(decryptApiKey(b)).toBe(plaintext);
  });

  it("marks the envelope with the discriminator and version", () => {
    const envelope = encryptApiKey("hello");
    expect(envelope.__enc).toBe(1);
    expect(envelope.v).toBe(1);
    expect(isEncryptedPayload(envelope)).toBe(true);
  });

  it("rejects tampered ciphertext (GCM auth tag fails)", () => {
    const envelope = encryptApiKey("sk-test-1");
    const tampered = {
      ...envelope,
      ciphertext: Buffer.from("deadbeef", "hex").toString("base64"),
    };
    expect(decryptApiKey(tampered)).toBeNull();
  });

  it("rejects tampered tag", () => {
    const envelope = encryptApiKey("sk-test-1");
    const tampered = {
      ...envelope,
      tag: Buffer.alloc(16, 0).toString("base64"),
    };
    expect(decryptApiKey(tampered)).toBeNull();
  });
});

describe("isEncryptedPayload", () => {
  it("detects legacy plaintext strings as not-encrypted", () => {
    expect(isEncryptedPayload("sk-test-1")).toBe(false);
  });

  it("detects arbitrary objects as not-encrypted", () => {
    expect(isEncryptedPayload({})).toBe(false);
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload(undefined)).toBe(false);
    expect(isEncryptedPayload({ __enc: 1 })).toBe(false);
    expect(isEncryptedPayload({ __enc: 1, ciphertext: "x", iv: "y" })).toBe(false);
  });

  it("accepts a well-formed envelope", () => {
    const env = encryptApiKey("hello");
    expect(isEncryptedPayload(env)).toBe(true);
  });
});

describe("decryptApiKey edge cases", () => {
  it("returns null for non-encrypted input", () => {
    expect(decryptApiKey(null)).toBeNull();
    expect(decryptApiKey(undefined)).toBeNull();
    expect(decryptApiKey("plaintext")).toBeNull();
    expect(decryptApiKey(42)).toBeNull();
    expect(decryptApiKey({})).toBeNull();
  });

  it("returns null for an envelope with the wrong version", () => {
    const env = encryptApiKey("hello");
    const wrong = { ...env, v: 99 };
    expect(decryptApiKey(wrong)).toBeNull();
  });
});

describe("maskApiKey", () => {
  it("masks long keys showing first 4 and last 4 characters", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1••••••••cdef");
  });

  it("falls back to bullets-only for short keys", () => {
    expect(maskApiKey("short")).toBe("••••");
  });

  it("returns empty string for empty/nullish input", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey(null)).toBe("");
    expect(maskApiKey(undefined)).toBe("");
  });
});

describe("key source", () => {
  it("accepts a 32-byte base64 key from INTEGRATION_ENCRYPTION_KEY", () => {
    // Sanity check the loader's length contract — generating a fresh key
    // and using it should round-trip cleanly.
    const fresh = randomBytes(32).toString("base64");
    const prior = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = fresh;
    __resetCryptoKeyForTests();
    try {
      const envelope = encryptApiKey("round-trip-with-env-key");
      expect(decryptApiKey(envelope)).toBe("round-trip-with-env-key");
    } finally {
      if (prior === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
      else process.env.INTEGRATION_ENCRYPTION_KEY = prior;
      __resetCryptoKeyForTests();
    }
  });

  it("rejects a wrong-length key with a clear error", () => {
    const bad = randomBytes(16).toString("base64");
    const prior = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = bad;
    __resetCryptoKeyForTests();
    try {
      expect(() => encryptApiKey("x")).toThrow(/32 bytes/);
    } finally {
      if (prior === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
      else process.env.INTEGRATION_ENCRYPTION_KEY = prior;
      __resetCryptoKeyForTests();
    }
  });
});