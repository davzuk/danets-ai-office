import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a Meta Cloud API webhook signature.
 *
 * Meta sends `X-Hub-Signature-256: sha256=<hex>`. We rebuild the HMAC of the
 * raw request body using the configured app secret and compare in constant
 * time. The signature header MUST be present; missing headers are a hard
 * reject because Meta always sends them on real deliveries.
 *
 * Returns true on success, false on any mismatch (length, prefix, or value).
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  if (provided.length === 0) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify a Twilio webhook signature.
 *
 * Twilio sends `X-Twilio-Signature`. The signature is HMAC-SHA1 of the full
 * URL + sorted form-encoded body, keyed by the account auth token.
 *
 * `formFields` is the parsed body from `req.formData()` (or `new URLSearchParams`).
 */
export function verifyTwilioSignature(
  fullUrl: string,
  formFields: URLSearchParams,
  signatureHeader: string | null,
  authToken: string
): boolean {
  if (!signatureHeader) return false;

  // Per Twilio spec: append key+value of each form field (sorted by key) to the URL.
  const sorted = [...formFields.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const data = sorted.reduce(
    (acc, [k, v]) => acc + k + v,
    fullUrl
  );

  const expected = createHmac("sha1", authToken).update(data).digest("base64");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}