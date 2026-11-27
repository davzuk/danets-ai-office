// The only way the server fetches a tenant-supplied URL (site audit, W).
//
// Guards against SSRF:
// - http(s) only, ports 80 and 443 only, no credentials in the URL;
// - every hostname is resolved by our own lookup, which refuses private,
//   loopback, link-local, metadata and other non-public addresses, and the
//   socket connects to exactly the address that was checked (no DNS-rebinding
//   window); IP literals are checked directly, since Node skips the lookup;
// - redirects are followed by hand (at most 5), each hop checked again and
//   passed through the caller's `allowRedirect`;
// - a timeout and a body cap.
//
// `allowPrivate` exists only so tests (and SEO_AUDIT_ALLOW_PRIVATE in local
// development) can crawl a fixture site on 127.0.0.1; it is ignored in
// production.

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import type { LookupAddress } from "node:dns";

export const AUDIT_BOT_TOKEN = "DanetsAuditBot";

export function auditUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const app = (env.NEXT_PUBLIC_APP_URL || env.APP_URL || "https://danets.ai").replace(/\/+$/, "");
  return `${AUDIT_BOT_TOKEN}/1.0 (+${app}/bot)`;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

export type BlockReason = "protocol" | "port" | "credentials" | "private_address" | "redirect_scope" | "too_many_redirects" | "dns";

export class FetchBlockedError extends Error {
  readonly reason: BlockReason;
  constructor(message: string, reason: BlockReason) {
    super(message);
    this.name = "FetchBlockedError";
    this.reason = reason;
  }
}

// ─── Address policy ──────────────────────────────────────────────────

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];
const V6_BLOCKED: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
];

const blocked = new net.BlockList();
for (const [a, p] of V4_BLOCKED) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of V6_BLOCKED) blocked.addSubnet(a, p, "ipv6");

/** Expand an IPv6 address to its 8 hextets, or null when it isn't one. */
function hextets(ip: string): number[] | null {
  if (net.isIPv6(ip) === false) return null;
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // A trailing dotted IPv4 part ("::ffff:1.2.3.4") becomes two hextets.
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const parts = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.map((x) => parseInt(x, 16));
}

/** The IPv4 address an IPv6 address carries (mapped, compatible or NAT64), if any. */
function embeddedV4(ip: string): string | null {
  const h = hextets(ip);
  if (!h) return null;
  const v4 = () => [h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255].join(".");
  const zeros = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (zeros(5) && h[5] === 0xffff) return v4(); // ::ffff:a.b.c.d
  if (zeros(6) && (h[6] !== 0 || h[7] > 1)) return v4(); // ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return v4(); // 64:ff9b::/96
  return null;
}

/** True when an address is safe to connect to from the server. */
export function isPublicAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) return !blocked.check(bare, "ipv4");
  if (net.isIPv6(bare)) {
    const v4 = embeddedV4(bare);
    if (v4) return !blocked.check(v4, "ipv4");
    const noZone = bare.split("%")[0];
    return !blocked.check(noZone, "ipv6");
  }
  return false;
}

/**
 * Test/dev escape hatch: `true` (or SEO_AUDIT_ALLOW_PRIVATE=1) allows every
 * address and port; a function allows just the addresses it accepts. Always
 * off in production.
 */
export type AllowPrivate = boolean | ((ip: string) => boolean);

function relaxedPorts(allowPrivate: AllowPrivate | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return !!allowPrivate || env.SEO_AUDIT_ALLOW_PRIVATE === "1";
}

function addressAllowed(ip: string, allowPrivate: AllowPrivate | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isPublicAddress(ip)) return true;
  if (env.NODE_ENV === "production") return false;
  if (env.SEO_AUDIT_ALLOW_PRIVATE === "1" || allowPrivate === true) return true;
  return typeof allowPrivate === "function" && allowPrivate(ip.replace(/^\[|\]$/g, ""));
}

/**
 * Parse and check a URL before any network use. Throws FetchBlockedError
 * for anything the fetcher won't touch.
 */
export function checkUrl(raw: string | URL, opts: { allowPrivate?: AllowPrivate } = {}): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new FetchBlockedError("That isn't a valid web address.", "protocol");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("Only http and https addresses can be fetched.", "protocol");
  if (url.username || url.password) throw new FetchBlockedError("Addresses with a username or password can't be fetched.", "credentials");
  if (url.port && !relaxedPorts(opts.allowPrivate) && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new FetchBlockedError("Only the standard web ports (80 and 443) can be fetched.", "port");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !addressAllowed(host, opts.allowPrivate)) {
    throw new FetchBlockedError("That address points at a private network.", "private_address");
  }
  return url;
}

export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

const systemLookup: LookupFn = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * A `lookup` for http.request that resolves with `resolve`, refuses the
 * whole answer if any address is non-public, and hands back only the
 * checked addresses, so the socket connects to what we checked.
 */
function guardedLookup(resolve: LookupFn, allowPrivate: AllowPrivate | undefined, onBlocked: (e: FetchBlockedError) => void): net.LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addrs) => {
        if (!addrs.length) throw new FetchBlockedError(`${hostname} didn't resolve.`, "dns");
        if (addrs.some((a) => !addressAllowed(a.address, allowPrivate))) {
          const e = new FetchBlockedError(`${hostname} points at a private network.`, "private_address");
          onBlocked(e);
          throw e;
        }
        const family = typeof options === "object" ? options.family : undefined;
        const usable = family === 4 || family === 6 ? addrs.filter((a) => a.family === family) : addrs;
        if (!usable.length) throw new FetchBlockedError(`${hostname} has no usable address.`, "dns");
        if (typeof options === "object" && options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      })
      .catch((e: Error & { code?: string }) => {
        const err = e instanceof FetchBlockedError ? e : Object.assign(new Error(e.message), { code: e.code ?? "ENOTFOUND" });
        callback(err as NodeJS.ErrnoException, "", 0);
      });
  };
}

// ─── Fetch ─────────────────────────────────────────────────────────────

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Return false to stop at a redirect (it is reported, not followed). */
  allowRedirect?: (next: URL, from: URL) => boolean;
  accept?: string;
  signal?: AbortSignal;
  allowPrivate?: AllowPrivate;
  /** Test hook: replaces DNS. */
  lookup?: LookupFn;
}

export interface SafeResponse {
  /** The URL that produced this response (after redirects). */
  url: string;
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: string;
  truncated: boolean;
  /** Each URL redirected from, in order. */
  redirects: string[];
  /** Set when a redirect was refused by allowRedirect; status is the 3xx. */
  blockedRedirect: string | null;
  elapsedMs: number;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
}

function requestOnce(url: URL, opts: SafeFetchOptions, deadline: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let blockedErr: FetchBlockedError | null = null;
    const mod = url.protocol === "https:" ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = mod.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: {
          "user-agent": auditUserAgent(),
          accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en",
        },
        lookup: guardedLookup(opts.lookup ?? systemLookup, opts.allowPrivate, (e) => (blockedErr = e)),
        agent: false,
        timeout: remaining,
        signal: opts.signal,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
        if (opts.method === "HEAD" || REDIRECT.has(res.statusCode ?? 0)) {
          res.resume();
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.alloc(0), truncated: false });
          return;
        }
        const enc = (headers["content-encoding"] || "").toLowerCase();
        const stream: NodeJS.ReadableStream =
          enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
        const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks), truncated });
        };
        stream.on("data", (c: Buffer) => {
          if (done) return;
          if (size + c.length > max) {
            chunks.push(c.subarray(0, max - size));
            size = max;
            finish(true);
            req.destroy();
            return;
          }
          chunks.push(c);
          size += c.length;
        });
        stream.on("end", () => finish(false));
        stream.on("error", (e) => (done ? undefined : reject(e)));
      }
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("The site took too long to answer."), { code: "ETIMEDOUT" })));
    req.on("error", (e) => reject(blockedErr ?? e));
    req.end();
  });
}

function decode(body: Buffer, contentType: string): string {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** Fetch a URL under the SSRF rules above. Network errors reject; HTTP errors resolve with their status. */
export async function safeFetch(raw: string | URL, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const started = Date.now();
  const deadline = started + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRedirects = Math.min(opts.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS);
  let url = checkUrl(raw, opts);
  const redirects: string[] = [];
  for (;;) {
    const res = await requestOnce(url, opts, deadline);
    const location = REDIRECT.has(res.status) ? res.headers["location"] : undefined;
    if (location) {
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        next = url;
      }
      if (next.href !== url.href) {
        if (redirects.length >= maxRedirects) throw new FetchBlockedError("Too many redirects.", "too_many_redirects");
        const checked = checkUrl(next, opts);
        if (opts.allowRedirect && !opts.allowRedirect(checked, url)) {
          return { url: url.href, status: res.status, headers: res.headers, contentType: res.headers["content-type"] ?? "", body: "", truncated: false, redirects, blockedRedirect: checked.href, elapsedMs: Date.now() - started };
        }
        redirects.push(url.href);
        url = checked;
        continue;
      }
    }
    const contentType = res.headers["content-type"] ?? "";
    return {
      url: url.href,
      status: res.status,
      headers: res.headers,
      contentType,
      body: res.body.length ? decode(res.body, contentType) : "",
      truncated: res.truncated,
      redirects,
      blockedRedirect: null,
      elapsedMs: Date.now() - started,
    };
  }
}

export function isHtml(contentType: string): boolean {
  return /^\s*(text\/html|application\/xhtml\+xml)/i.test(contentType);
}
