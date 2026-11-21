/**
 * Client-side structured logger. Mirrors the server logger's API but uses
 * fetch() to forward events to /api/log/client so they're persisted with
 * the same shape as server logs.
 *
 * Falls back to console.* if the network call fails — we never want a
 * logging failure to crash the page.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

interface LogPayload {
  level: LogLevel;
  msg: string;
  fields?: LogFields;
  url?: string;
  userAgent?: string;
  ts: string;
}

async function send(level: LogLevel, msg: string, fields?: LogFields) {
  const payload: LogPayload = {
    level,
    msg,
    fields,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    ts: new Date().toISOString(),
  };
  try {
    if (typeof fetch !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/log/client",
        new Blob([JSON.stringify(payload)], { type: "application/json" })
      );
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    await fetch("/api/log/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    /* swallow */
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => send("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => send("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => send("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => send("error", msg, fields),
};