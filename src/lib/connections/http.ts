import { OAuthGrantError, OAuthProviderError } from "./types";

const TIMEOUT_MS = 15_000;

/**
 * Fetch JSON from a provider. 4xx responses that describe an auth/grant
 * problem become OAuthGrantError (not retryable); everything else that
 * fails becomes OAuthProviderError (retryable).
 */
export async function providerFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new OAuthProviderError(`Network error: ${(e as Error).message}`);
  }

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; handled below
  }

  if (res.ok) return body as T;

  // Google: { error: "invalid_grant", error_description }
  // Meta:   { error: { message, type: "OAuthException", code } }
  const code: string | undefined =
    typeof body?.error === "string" ? body.error : body?.error?.type ?? body?.error?.code?.toString();
  const message: string =
    body?.error_description ?? body?.error?.message ?? (text.slice(0, 200) || `HTTP ${res.status}`);

  const isGrantProblem =
    res.status === 400 || res.status === 401 || res.status === 403
      ? ["invalid_grant", "invalid_token", "unauthorized_client", "invalid_client", "OAuthException", "190"].includes(
          code ?? ""
        ) || res.status === 401
      : false;

  if (isGrantProblem) throw new OAuthGrantError(message, code);
  throw new OAuthProviderError(message, res.status);
}

export function form(params: Record<string, string | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out.set(k, v);
  return out;
}

export function expiresAtFrom(expiresIn: unknown, now = Date.now()): Date | null {
  const secs = Number(expiresIn);
  return Number.isFinite(secs) && secs > 0 ? new Date(now + secs * 1000) : null;
}
