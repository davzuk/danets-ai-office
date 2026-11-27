// Signed, expiring download links for lead magnets (Phase 2, workstream T).
// The link carries the magnet id, the gate submission id and an expiry,
// signed with HMAC-SHA256, so it can't be altered or reused for another
// magnet, and stops working after LINK_TTL_MS.

import { createHmac, timingSafeEqual } from "node:crypto";

export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

function secret(env: Env = process.env): string {
  const s = env.MAGNET_LINK_SECRET || env.INTEGRATION_ENCRYPTION_KEY;
  if (s) return `magnet-link:${s}`;
  if (env.NODE_ENV === "production") throw new Error("MAGNET_LINK_SECRET is not set");
  return "magnet-link:dev-only-secret";
}

export interface MagnetLink {
  magnetId: string;
  submissionId: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

function payload(l: MagnetLink) {
  return `${l.magnetId}.${l.submissionId}.${l.exp}`;
}

export function signMagnetLink(l: MagnetLink, env: Env = process.env): string {
  return createHmac("sha256", secret(env)).update(payload(l)).digest("base64url");
}

/** Query parameters for a fresh link that expires LINK_TTL_MS from `now`. */
export function magnetLinkParams(magnetId: string, submissionId: string, now = Date.now(), env: Env = process.env) {
  const link = { magnetId, submissionId, exp: now + LINK_TTL_MS };
  return { m: magnetId, s: submissionId, e: String(link.exp), sig: signMagnetLink(link, env) };
}

export type LinkCheck = { ok: true; link: MagnetLink } | { ok: false; reason: "invalid" | "expired" };

const ID = /^[a-z0-9]{10,40}$/i;

export function verifyMagnetLink(q: { m?: string | null; s?: string | null; e?: string | null; sig?: string | null }, now = Date.now(), env: Env = process.env): LinkCheck {
  const { m, s, e, sig } = q;
  if (!m || !s || !e || !sig || !ID.test(m) || !ID.test(s) || !/^\d{1,15}$/.test(e)) return { ok: false, reason: "invalid" };
  const link = { magnetId: m, submissionId: s, exp: Number(e) };
  const want = Buffer.from(signMagnetLink(link, env));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "invalid" };
  if (link.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, link };
}
