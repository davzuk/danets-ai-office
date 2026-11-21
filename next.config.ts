import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * The middleware in `src/middleware.ts` mints a per-request nonce and
 * sets a `Content-Security-Policy` header on every page response with
 * that nonce baked into `script-src`. We deliberately do NOT set a CSP
 * header here for page routes — that would race the middleware and
 * the per-request nonce would be ignored.
 *
 * API routes keep their own tight policy (`default-src 'none'`) set
 * here — they never execute script.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "mammoth"],
  // lucide-react ships every icon in one file (~1.5MB ESM); without
  // this directive every dashboard view pulls the whole tree. The
  // radix packages similarly have lots of files we don't all use.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
    ],
  },
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