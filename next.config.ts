import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` are kept for scripts and styles to
 * avoid breaking Next.js dev tooling + React 19 Server Component hydration,
 * which still rely on inline runtime scripts at this version. A CSP-nonce
 * variant is a deliberate follow-up (out of scope for P11).
 *
 * The `frame-src` and `connect-src` allow Paystack + Flutterwave so the
 * payment iframe and verify API continue to load. `frame-ancestors 'none'`
 * blocks clickjacking via `<iframe>` embedding on third-party origins
 * (replaces the older X-Frame-Options for modern browsers, but we keep both
 * for legacy compatibility).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co https://checkout.flutterwave.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.paystack.co https://api.flutterwave.com wss:",
  "frame-src https://js.paystack.co https://checkout.flutterwave.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "mammoth"],
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  async headers() {
    const baseHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-XSS-Protection", value: "1; mode=block" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        // Tightened: payments, USB, and sensors all blocked. Browsers ignore
        // directives they don't recognize, so adding new ones is safe.
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()",
      },
      { key: "Content-Security-Policy", value: CSP },
    ];

    // HSTS only in production — local dev runs over plain HTTP and HSTS
    // pins that into browsers, breaking the dev experience.
    if (isProduction) {
      baseHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/(.*)",
        headers: baseHeaders,
      },
      {
        source: "/api/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
          ...(isProduction
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;