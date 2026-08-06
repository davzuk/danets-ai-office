import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock `next/headers` cookies() BEFORE importing the auth module.
const cookieStore: { value: Record<string, string> } = { value: {} };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.value[name]
        ? { name, value: cookieStore.value[name] }
        : undefined,
    set: (name: string, value: string) => {
      cookieStore.value[name] = value;
    },
    delete: (name: string) => {
      delete cookieStore.value[name];
    },
  }),
  headers: async () => ({
    get: () => null,
  }),
}));

// Mock Prisma — track session rows by id and capture updates/creates.
const sessions = new Map<string, any>();

vi.mock("@/lib/db", () => {
  return {
    db: {
      session: {
        findUnique: async ({ where }: any) => sessions.get(where.id) ?? null,
        findUniqueByToken: async ({ where }: any) => {
          for (const s of sessions.values()) {
            if (s.token === where.token) return s;
          }
          return null;
        },
        update: async ({ where, data }: any) => {
          const cur = sessions.get(where.id);
          if (!cur) throw new Error("not found");
          const next = { ...cur, ...data };
          sessions.set(where.id, next);
          return next;
        },
        delete: async ({ where }: any) => {
          const v = sessions.get(where.id);
          sessions.delete(where.id);
          return v;
        },
        create: async ({ data }: any) => {
          const id = `sess_${Math.random().toString(36).slice(2, 10)}`;
          const row = { id, ...data };
          sessions.set(id, row);
          return row;
        },
        deleteMany: async ({ where }: any) => {
          let count = 0;
          for (const [k, v] of sessions.entries()) {
            if (where?.token && v.token === where.token) {
              sessions.delete(k);
              count++;
            }
          }
          return { count };
        },
      },
      $transaction: async (arg: any) => {
        // Prisma's interactive transaction form. Run inline.
        if (Array.isArray(arg)) {
          for (const op of arg) await op;
          return undefined;
        }
        return arg({
          session: {
            delete: async ({ where }: any) => {
              const v = sessions.get(where.id);
              sessions.delete(where.id);
              return v;
            },
            create: async ({ data }: any) => {
              const id = `sess_${Math.random().toString(36).slice(2, 10)}`;
              const row = { id, ...data };
              sessions.set(id, row);
              return row;
            },
          },
        });
      },
    },
  };
});

vi.mock("@/lib/csrf", () => ({
  ensureCsrfForSession: async () => "csrf-stub",
  verifyCsrf: async () => undefined,
}));

vi.mock("@/lib/platform-config", () => ({
  getPlatformConfig: async () => ({ maintenanceMode: false, defaultSignupPlan: "free" } as any),
}));

vi.mock("@/lib/subscription-access", () => ({
  enforceSubscriptionAccess: async () => undefined,
}));

vi.mock("@/lib/module-access", () => ({
  enforceModuleAccess: async () => undefined,
}));

vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/logger", () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

import { rotateSessionIfStale, touchSession } from "@/lib/auth";

describe("session rotation (P10)", () => {
  beforeEach(() => {
    sessions.clear();
    cookieStore.value = {};
  });

  afterEach(() => {
    sessions.clear();
    cookieStore.value = {};
  });

  function seedSession(overrides: Partial<{ id: string; lastSeenAt: Date | null; absoluteExpiresAt: Date; businessUserId: string; businessId: string }> = {}) {
    const id = overrides.id ?? "sess_seed";
    const row = {
      id,
      token: "tok_" + id,
      csrfToken: "csrf_" + id,
      businessUserId: overrides.businessUserId ?? "u_1",
      businessId: overrides.businessId ?? "b_1",
      lastSeenAt: overrides.lastSeenAt ?? null,
      absoluteExpiresAt: overrides.absoluteExpiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    sessions.set(id, row);
    cookieStore.value["danets_session"] = row.token;
    return row;
  }

  it("destroys the session when lastSeenAt is past the idle window", async () => {
    const row = seedSession({ lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) });
    await expect(
      rotateSessionIfStale({
        id: row.id,
        token: row.token,
        businessUserId: row.businessUserId,
        businessId: row.businessId,
        absoluteExpiresAt: row.absoluteExpiresAt,
        lastSeenAt: row.lastSeenAt,
        csrfToken: row.csrfToken,
      })
    ).rejects.toThrow("UNAUTHORIZED");
    expect(sessions.has(row.id)).toBe(false);
  });

  it("destroys the session when past the absolute cap", async () => {
    const row = seedSession({
      // lastSeenAt one minute ago so the idle check passes — the test is
      // isolating the absolute-cap branch, not the idle branch.
      lastSeenAt: new Date(Date.now() - 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      rotateSessionIfStale({
        id: row.id,
        token: row.token,
        businessUserId: row.businessUserId,
        businessId: row.businessId,
        absoluteExpiresAt: row.absoluteExpiresAt,
        lastSeenAt: row.lastSeenAt,
        csrfToken: row.csrfToken,
      })
    ).rejects.toThrow("EXPIRED");
    expect(sessions.has(row.id)).toBe(false);
  });

  it("takes the cheap path when lastSeenAt is fresh", async () => {
    const row = seedSession({ lastSeenAt: new Date(Date.now() - 60 * 1000) }); // 1 min ago
    const out = await rotateSessionIfStale({
      id: row.id,
      token: row.token,
      businessUserId: row.businessUserId,
      businessId: row.businessId,
      absoluteExpiresAt: row.absoluteExpiresAt,
      lastSeenAt: row.lastSeenAt,
      csrfToken: row.csrfToken,
    });
    expect(out).toBeNull();
    // Row still exists.
    expect(sessions.has(row.id)).toBe(true);
  });

  it("rotates the token when lastSeenAt is past the rotate threshold", async () => {
    const row = seedSession({ lastSeenAt: new Date(Date.now() - 20 * 60 * 1000) }); // 20 min ago
    const newToken = await rotateSessionIfStale({
      id: row.id,
      token: row.token,
      businessUserId: row.businessUserId,
      businessId: row.businessId,
      absoluteExpiresAt: row.absoluteExpiresAt,
      lastSeenAt: row.lastSeenAt,
      csrfToken: row.csrfToken,
    });
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(row.token);
    // Old row gone, new row present.
    expect(sessions.has(row.id)).toBe(false);
    let foundNew: any | null = null;
    for (const s of sessions.values()) {
      if (s.token === newToken) foundNew = s;
    }
    expect(foundNew).toBeTruthy();
    expect(foundNew.businessUserId).toBe(row.businessUserId);
    expect(foundNew.businessId).toBe(row.businessId);
    expect(foundNew.absoluteExpiresAt.getTime()).toBe(row.absoluteExpiresAt.getTime());
    // Cookie updated.
    expect(cookieStore.value["danets_session"]).toBe(newToken);
  });
});

describe("touchSession", () => {
  beforeEach(() => {
    sessions.clear();
  });

  it("updates lastSeenAt on the named session", async () => {
    const row = {
      id: "sess_touch",
      token: "tok_touch",
      csrfToken: "csrf_touch",
      businessUserId: "u_1",
      businessId: "b_1",
      lastSeenAt: null,
      absoluteExpiresAt: new Date(Date.now() + 60_000),
    };
    sessions.set(row.id, row);

    await touchSession(row.id);
    const after = sessions.get(row.id);
    expect(after.lastSeenAt).toBeInstanceOf(Date);
  });

  it("swallows errors silently (logging is best-effort)", async () => {
    // No row with this id — touchSession should not throw.
    await expect(touchSession("does_not_exist")).resolves.toBeUndefined();
  });
});