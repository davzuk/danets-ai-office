import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRequestContext,
  logger,
  serializeError,
  setRequestContextField,
  withRequestContext,
} from "@/lib/logger";

const captureStdout = () => {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: any, ...rest: any[]) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return original(chunk as any, ...(rest as []));
    });
  return { writes, restore: () => spy.mockRestore() };
};

// Vitest's typings lock down NODE_ENV as readonly (Next.js conventions).
// The logger reads it at call time so swapping it during the test is safe.
const setNodeEnv = (value: string | undefined) => {
  Object.assign(process.env, { NODE_ENV: value });
};

describe("logger", () => {
  let originalEnv: string | undefined;
  let stdout: { writes: string[]; restore: () => void };

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    stdout = captureStdout();
  });

  afterEach(() => {
    setNodeEnv(originalEnv);
    stdout.restore();
  });

  it("emits a single JSON line in production", () => {
    setNodeEnv("production");
    logger.info("hello world", { foo: "bar" });
    expect(stdout.writes).toHaveLength(1);
    const line = stdout.writes[0].replace(/\n$/, "");
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello world");
    expect(parsed.foo).toBe("bar");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits a pretty single line in dev", () => {
    setNodeEnv("development");
    logger.warn("careful", { x: 1 });
    expect(stdout.writes).toHaveLength(1);
    const line = stdout.writes[0];
    // Dev format is human-readable and contains ANSI color codes — we just
    // assert the level, msg, and meta are present.
    expect(line).toContain("[warn]");
    expect(line).toContain("careful");
    expect(line).toContain("x=");
  });

  it("skips undefined values in meta", () => {
    setNodeEnv("production");
    logger.info("hi", { a: 1, b: undefined, c: "see" });
    const parsed = JSON.parse(stdout.writes[0].replace(/\n$/, ""));
    expect(parsed.a).toBe(1);
    expect(parsed.c).toBe("see");
    expect("b" in parsed).toBe(false);
  });

  it("includes request context fields via AsyncLocalStorage", async () => {
    setNodeEnv("production");
    await withRequestContext({ requestId: "req-123", userId: "u-1", businessId: "b-2", route: "/api/x" }, async () => {
      logger.info("inside");
      const parsed = JSON.parse(stdout.writes[0].replace(/\n$/, ""));
      expect(parsed.requestId).toBe("req-123");
      expect(parsed.userId).toBe("u-1");
      expect(parsed.businessId).toBe("b-2");
      expect(parsed.route).toBe("/api/x");
    });
    // After the context exits, the logger no longer carries it.
    logger.info("outside");
    const parsed = JSON.parse(stdout.writes[1].replace(/\n$/, ""));
    expect(parsed.requestId).toBeUndefined();
  });

  it("setRequestContextField updates the active context", async () => {
    setNodeEnv("production");
    await withRequestContext({ requestId: "req-init" }, async () => {
      expect(getRequestContext()?.requestId).toBe("req-init");
      setRequestContextField("requestId", "req-updated");
      logger.info("after-update");
      const parsed = JSON.parse(stdout.writes[0].replace(/\n$/, ""));
      expect(parsed.requestId).toBe("req-updated");
    });
  });
});

describe("serializeError", () => {
  it("extracts name + message from a thrown Error", () => {
    const err = new Error("boom");
    err.name = "CustomError";
    const meta = serializeError(err);
    expect(meta.errName).toBe("CustomError");
    expect(meta.errMessage).toBe("boom");
  });

  it("extracts .code when present", () => {
    const err = Object.assign(new Error("boom"), { code: "ENOENT" });
    const meta = serializeError(err);
    expect(meta.errCode).toBe("ENOENT");
  });

  it("includes stack in dev but not in production", () => {
    setNodeEnv("production");
    const metaProd = serializeError(new Error("x"));
    expect(metaProd.stack).toBeUndefined();

    setNodeEnv("development");
    const metaDev = serializeError(new Error("x"));
    expect(typeof metaDev.stack).toBe("string");
  });

  it("handles non-Error throws", () => {
    expect(serializeError("plain string")).toEqual({ errMessage: "plain string" });
    expect(serializeError(null)).toEqual({});
    expect(serializeError(undefined)).toEqual({});
    expect(serializeError(42)).toEqual({ errMessage: "42" });
  });
});