/** Pure subscription path rules — exported for unit tests. */

export const BILLING_EXEMPT_PREFIXES = [
  "/api/subscription",
  "/api/payments/",
  "/api/invoices",
  "/api/auth/",
];

export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isBillingExempt(pathname: string): boolean {
  return BILLING_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isEnforcedApiPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/api/super-admin/")) return false;
  if (pathname.startsWith("/api/platform-auth/")) return false;
  if (pathname.startsWith("/api/public/")) return false;
  if (pathname.startsWith("/api/health")) return false;
  return true;
}
