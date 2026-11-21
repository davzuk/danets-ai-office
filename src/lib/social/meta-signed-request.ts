// Meta `signed_request` (deauthorize + data-deletion callbacks):
//   "<base64url HMAC-SHA256(payload, app secret)>.<base64url JSON payload>"

import { createHmac, timingSafeEqual } from "crypto";

export interface MetaSignedRequest {
  user_id: string;
  algorithm: string;
  issued_at?: number;
  [k: string]: unknown;
}

/** Verified payload, or null if malformed, unsigned or signed with another secret. */
export function parseMetaSignedRequest(signedRequest: string | null | undefined, appSecret: string | undefined): MetaSignedRequest | null {
  if (!signedRequest || !appSecret) return null;
  const [sig, payload, ...rest] = signedRequest.split(".");
  if (!sig || !payload || rest.length) return null;

  const expected = createHmac("sha256", appSecret).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const d = data as Partial<MetaSignedRequest> | null;
  if (!d || typeof d !== "object" || String(d.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
  const userId = typeof d.user_id === "number" ? String(d.user_id) : d.user_id;
  if (typeof userId !== "string" || !userId) return null;
  return { ...d, user_id: userId, algorithm: "HMAC-SHA256" } as MetaSignedRequest;
}

/** Test/helper: build a signed request (used by tests). */
export function signMetaRequest(payload: Record<string, unknown>, appSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", appSecret).update(body).digest("base64url");
  return `${sig}.${body}`;
}
