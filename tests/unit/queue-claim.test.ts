import { beforeEach, describe, expect, it, vi } from "vitest";

// claimBatch against a fake Prisma client: checks the SKIP LOCKED fallback
// for MariaDB < 10.6 / MySQL < 8 without a database.
const queries: string[] = [];
let rejectSkipLocked = false;

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    queries.push(sql);
    if (rejectSkipLocked && sql.includes("SKIP LOCKED")) {
      throw Object.assign(new Error("Raw query failed. Code: `1064`. You have an error in your SQL syntax; near 'SKIP LOCKED'"), {
        code: "P2010",
        meta: { code: "1064", message: "You have an error in your SQL syntax; check the manual near 'SKIP LOCKED' at line 5" },
      });
    }
    return [{ id: "j1" }];
  }),
  job: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findMany: vi.fn(async () => [{ id: "j1" }]),
  },
};

vi.mock("@/lib/db", () => ({
  db: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}));

const { claimBatch, isSkipLockedUnsupported, resetSkipLockedDetection } = await import("@/lib/jobs/queue");

describe("claimBatch SKIP LOCKED fallback", () => {
  beforeEach(() => {
    queries.length = 0;
    resetSkipLockedDetection();
    vi.clearAllMocks();
  });

  it("uses SKIP LOCKED when the server supports it", async () => {
    rejectSkipLocked = false;
    await expect(claimBatch("w", 2)).resolves.toHaveLength(1);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("SKIP LOCKED");
  });

  it("falls back to FOR UPDATE once, then stays on it", async () => {
    rejectSkipLocked = true;
    await expect(claimBatch("w", 2)).resolves.toHaveLength(1);
    await expect(claimBatch("w", 2)).resolves.toHaveLength(1);
    expect(queries.filter((q) => q.includes("SKIP LOCKED"))).toHaveLength(1);
    expect(queries.filter((q) => /FOR UPDATE\s*$/.test(q))).toHaveLength(2);
  });

  it("only claims rows that are still queued", async () => {
    rejectSkipLocked = false;
    await claimBatch("w", 2);
    expect(tx.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["j1"] }, status: "queued" } }));
  });

  it("recognises only the SKIP LOCKED syntax error", () => {
    expect(isSkipLockedUnsupported({ meta: { code: "1064", message: "syntax near 'SKIP LOCKED'" } })).toBe(true);
    expect(isSkipLockedUnsupported(new Error("Deadlock found when trying to get lock"))).toBe(false);
    expect(isSkipLockedUnsupported({ meta: { code: "1064", message: "syntax near 'LIMIT'" } })).toBe(false);
    expect(isSkipLockedUnsupported(null)).toBe(false);
  });
});
