// OAuth `state` + PKCE handling.
//
// The authorize redirect carries only a random nonce as `state`. The nonce,
// the PKCE verifier and who started the flow are kept server-readable-only
// in an encrypted, httpOnly cookie scoped to the callback path. The callback
// accepts the code only if the cookie decrypts, is fresh, its nonce matches
// `state`, and it was minted for the same user and business.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { decryptApiKey, encryptApiKey } from "@/lib/crypto";
import type { ConnectionProviderId } from "./types";

export const OAUTH_STATE_COOKIE = "danets_oauth_state";
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface OAuthStatePayload {
  nonce: string;
  provider: ConnectionProviderId;
  businessId: string;
  userId: string;
  codeVerifier?: string;
  createdAt: number;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48)); // 64 chars, within RFC 7636's 43–128
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState(args: {
  provider: ConnectionProviderId;
  businessId: string;
  userId: string;
  pkce: boolean;
  now?: number;
}): { state: string; codeChallenge?: string; cookieValue: string } {
  const nonce = base64url(randomBytes(24));
  const pair = args.pkce ? createPkcePair() : undefined;
  const payload: OAuthStatePayload = {
    nonce,
    provider: args.provider,
    businessId: args.businessId,
    userId: args.userId,
    codeVerifier: pair?.verifier,
    createdAt: args.now ?? Date.now(),
  };
  const cookieValue = Buffer.from(JSON.stringify(encryptApiKey(JSON.stringify(payload)))).toString("base64url");
  return { state: nonce, codeChallenge: pair?.challenge, cookieValue };
}

export type StateCheck =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "mismatch" };

export function verifyOAuthState(args: {
  cookieValue: string | undefined;
  state: string | null;
  provider: ConnectionProviderId;
  businessId: string;
  userId: string;
  now?: number;
}): StateCheck {
  if (!args.cookieValue || !args.state) return { ok: false, reason: "missing" };

  let payload: OAuthStatePayload;
  try {
    const envelope = JSON.parse(Buffer.from(args.cookieValue, "base64url").toString("utf8"));
    const plain = decryptApiKey(envelope);
    if (!plain) return { ok: false, reason: "invalid" };
    payload = JSON.parse(plain);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if ((args.now ?? Date.now()) - payload.createdAt > OAUTH_STATE_TTL_MS) return { ok: false, reason: "expired" };

  const a = Buffer.from(payload.nonce ?? "");
  const b = Buffer.from(args.state);
  const nonceOk = a.length === b.length && timingSafeEqual(a, b);
  if (
    !nonceOk ||
    payload.provider !== args.provider ||
    payload.businessId !== args.businessId ||
    payload.userId !== args.userId
  ) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, payload };
}
