// Graph API calls for publishing, with Meta's error codes sorted into what
// the publish job should do about them. providerFetch can't be used here: it
// treats every OAuthException as an auth failure, but Meta also returns
// OAuthException for rate limits, which must be retried.

import { authed, graph } from "@/lib/connections/providers/meta";
import type { Env } from "@/lib/connections/types";

export type PublishErrorKind =
  /** Token revoked/expired or permission missing: mark the account, notify, don't retry. */
  | "auth"
  /** Throttled or Meta-side trouble: retry with backoff. */
  | "retry"
  /** Meta refused this content (format, size, policy): don't retry; tell the user why. */
  | "content";

export class PublishError extends Error {
  constructor(
    message: string,
    public readonly kind: PublishErrorKind,
    public readonly code?: number,
    public readonly subcode?: number
  ) {
    super(message);
    this.name = "PublishError";
  }
}

const AUTH_CODES = new Set([102, 190, 458, 459, 460, 463, 464, 467]);
const RATE_CODES = new Set([4, 17, 32, 341, 613]);
const TRANSIENT_CODES = new Set([1, 2]);
// Instagram: media still processing / publishing limit reached.
const IG_RETRY_SUBCODES = new Set([2207027, 2207042, 2207051]);

export function classifyMetaError(status: number, body: unknown): PublishError {
  const err = (body as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; is_transient?: boolean } })?.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const message = err?.error_user_msg || err?.message || `HTTP ${status}`;
  let kind: PublishErrorKind;
  if (code !== undefined && (AUTH_CODES.has(code) || code === 10 || (code >= 200 && code <= 299))) kind = "auth";
  else if (status === 401) kind = "auth";
  else if (code !== undefined && (RATE_CODES.has(code) || (code >= 80000 && code <= 80014))) kind = "retry";
  else if (subcode !== undefined && IG_RETRY_SUBCODES.has(subcode)) kind = "retry";
  else if (err?.is_transient || (code !== undefined && TRANSIENT_CODES.has(code)) || status >= 500 || status === 429) kind = "retry";
  else kind = "content";
  return new PublishError(message, kind, code, subcode);
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GraphClient {
  post<T>(path: string, params: Record<string, string>): Promise<T>;
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
}

/** A Graph client bound to one Page/IG token. `fetchImpl` is injectable for tests. */
export function graphClient(token: string, env: Env = process.env, fetchImpl: FetchLike = fetch): GraphClient {
  async function call<T>(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
    const body = authed(env, token, params);
    const url = method === "GET" ? `${graph(env, path)}?${body}` : graph(env, path);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        ...(method === "POST" ? { headers: { "content-type": "application/x-www-form-urlencoded" }, body } : {}),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new PublishError(`Network error: ${(e as Error).message}`, "retry");
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON
    }
    if (!res.ok) throw classifyMetaError(res.status, json ?? { error: { message: text.slice(0, 200) } });
    return json as T;
  }
  return {
    post: (path, params) => call("POST", path, params),
    get: (path, params) => call("GET", path, params),
  };
}
