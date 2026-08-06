import { describe, expect, it, vi } from "vitest";
import {
  generateBackupCodes,
  hashBackupCode,
} from "@/lib/totp";

describe("generateBackupCodes", () => {
  it("returns the requested number of codes", () => {
    expect(generateBackupCodes().length).toBe(8);
    expect(generateBackupCodes(4).length).toBe(4);
    expect(generateBackupCodes(0).length).toBe(0);
  });

  it("produces 8-char uppercase hex codes", () => {
    for (const code of generateBackupCodes(16)) {
      expect(code).toMatch(/^[0-9A-F]{8}$/);
    }
  });
});

describe("hashBackupCode", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const h = hashBackupCode("ABCD1234");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes case and whitespace before hashing", () => {
    const a = hashBackupCode("abcd1234");
    const b = hashBackupCode("ABCD1234");
    const c = hashBackupCode("  abcd 1234 ");
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("different codes produce different hashes", () => {
    expect(hashBackupCode("AAAA1111")).not.toBe(hashBackupCode("BBBB2222"));
  });
});

describe("consumeBackupCode", () => {
  it("rejects malformed input without touching the database", async () => {
    const tx = {
      businessUser: { findUnique: vi.fn(), update: vi.fn() },
    };
    const db = { $transaction: vi.fn() } as any;
    const { consumeBackupCode } = await import("@/lib/totp");
    const ok = await consumeBackupCode(db, "u1", "nope");
    expect(ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("consumes a matching hash atomically and returns true", async () => {
    const code = "DEADBEEF";
    const target = hashBackupCode(code);

    const tx = {
      businessUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ totpBackupCodes: [target, "other"] }),
        update: vi.fn().mockImplementation(async ({ data }) => {
          // Reflect the consumed state for inspection.
          tx.businessUser.findUnique.mockResolvedValue({
            totpBackupCodes: data.totpBackupCodes,
          });
          return { id: "u1" };
        }),
      },
    };
    const db = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as any;

    const { consumeBackupCode } = await import("@/lib/totp");
    const ok = await consumeBackupCode(db, "u1", code);
    expect(ok).toBe(true);
    expect(tx.businessUser.findUnique).toHaveBeenCalled();
    expect(tx.businessUser.update).toHaveBeenCalledOnce();
    const passedData = tx.businessUser.update.mock.calls[0][0].data;
    expect(passedData.totpBackupCodes).toEqual(["other"]);
  });

  it("returns false on unknown code and does not write", async () => {
    const tx = {
      businessUser: {
        findUnique: vi.fn().mockResolvedValue({ totpBackupCodes: ["nothash"] }),
        update: vi.fn(),
      },
    };
    const db = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as any;

    const { consumeBackupCode } = await import("@/lib/totp");
    const ok = await consumeBackupCode(db, "u1", "DEADBEEF");
    expect(ok).toBe(false);
    expect(tx.businessUser.update).not.toHaveBeenCalled();
  });
});