import { AsyncLocalStorage } from "async_hooks";

/**
 * Structured logger. Emits one JSON line per call in production so log
 * aggregators can index on `level`, `route`, `requestId`, `businessId`,
 * `userId`, and any custom fields. In dev it stays human-readable on a
 * single line so the Next.js terminal output doesn't drown in JSON.
 *
 * Per-request context (requestId, businessId, userId) is bound through
 * `withRequestContext` using AsyncLocalStorage so any deeper helper that
 * just calls `logger.error(...)` automatically inherits the context
 * without having to thread it through every call signature.
 */

type Level = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown>;

export type LogRecord = {
  ts: string;
  level: Level;
  msg: string;
  requestId?: string;
  userId?: string;
  businessId?: string;
  route?: string;
  latencyMs?: number;
  statusCode?: number;
  [key: string]: unknown;
};

type Context = {
  requestId?: string;
  userId?: string;
  businessId?: string;
  route?: string;
};

const storage = new AsyncLocalStorage<Context>();

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function now(): string {
  return new Date().toISOString();
}

function baseRecord(level: Level, msg: string): LogRecord {
  const ctx = storage.getStore();
  return {
    ts: now(),
    level,
    msg,
    ...(ctx?.requestId && { requestId: ctx.requestId }),
    ...(ctx?.userId && { userId: ctx.userId }),
    ...(ctx?.businessId && { businessId: ctx.businessId }),
    ...(ctx?.route && { route: ctx.route }),
  };
}

function emit(level: Level, msg: string, meta?: LogMeta) {
  const record = baseRecord(level, msg);
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v === undefined) continue;
      record[k] = v;
    }
  }
  if (isProduction()) {
    // Single-line JSON — every aggregator needs that contract.
    process.stdout.write(JSON.stringify(record) + "\n");
    return;
  }
  // Dev: color-coded, key=value pairs for readability.
  const color =
    level === "error" ? "\x1b[31m" :
    level === "warn" ? "\x1b[33m" :
    level === "debug" ? "\x1b[90m" : "\x1b[36m";
  const reset = "\x1b[0m";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (k === "ts" || k === "level" || k === "msg") continue;
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  const line = `${color}[${level}]${reset} ${record.msg}${parts.length ? "  " + parts.join(" ") : ""}`;
  process.stdout.write(line + "\n");
}

export const logger = {
  debug(msg: string, meta?: LogMeta) { emit("debug", msg, meta); },
  info(msg: string, meta?: LogMeta) { emit("info", msg, meta); },
  warn(msg: string, meta?: LogMeta) { emit("warn", msg, meta); },
  error(msg: string, meta?: LogMeta) { emit("error", msg, meta); },
};

/**
 * Run `fn` with the given request-scoped context. Anything that runs
 * synchronously (or via `await`) inside the callback inherits the
 * context — including deep helpers that call `logger.error` without
 * having been passed the request id explicitly.
 */
export function withRequestContext<T>(
  ctx: Context,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return storage.run(ctx, fn);
}

export function setRequestContextField<K extends keyof Context>(
  key: K,
  value: Context[K]
): void {
  const ctx = storage.getStore();
  if (ctx) ctx[key] = value;
}

export function getRequestContext(): Context | undefined {
  return storage.getStore();
}

/**
 * Normalize an `unknown` thrown value into a safe-for-logging object.
 * Strips the stack in production to keep log volume down — the aggregator
 * only needs the error name, message, and code for alerting.
 */
export function serializeError(err: unknown): LogMeta {
  if (err == null) return {};
  if (err instanceof Error) {
    const out: LogMeta = {
      errName: err.name,
      errMessage: err.message,
    };
    const code = (err as Error & { code?: unknown }).code;
    if (code !== undefined) out.errCode = String(code);
    if (!isProduction()) out.stack = err.stack;
    return out;
  }
  return { errMessage: String(err) };
}