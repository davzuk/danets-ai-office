# Platform-only sites — rework plan

**Agreed:** 2026-11-24. Supersedes the tenant-facing direction of Phase 2 workstreams Q/R/S/T.

**Status:** A, B and C are implemented. C covers TXT verification of white-label domains (`white-label.verify-domains`) and host-based branding of the login and dashboard (`/api/brand`, `/api/auth/me` `brand` field, `DanetsLogo`/`AuthScreen`/`AppShell` brand props). The site CMS now lives in the platform console (`/api/super-admin/sites/*`, with the workstream R AI page builder); the tenant `/api/site/*` routes are removed. Remaining follow-up: apply `customCss` and a global primary-color theme in the root layout.

## Direction (confirmed)

- Tenants do **not** build a website or have a CMS. There is no tenant-facing Website view.
- Only the **Platform (SaaS operator)** builds and manages tenant sites, in the platform console.
- A tenant's custom domain is a **white-label domain**: it serves the tenant's branded **login + the full tenant app on that same domain** — never a website.
- Platform-built landing pages (if kept) live on the Danets subdomain (`<sub>.SITES_DOMAIN`) only.

## Parts

### A. De-tenant the Website CMS
- Remove the `Website` nav entry and view route from the tenant dashboard (`app-shell.tsx`, `command-palette.tsx`, `app/(main)/app/page.tsx`).
- The `/api/site/**` tenant routes stay for now but are unreachable from the UI; Part B re-scopes them to the platform console.

### B. Drop website custom domains
- Remove `TenantSite.customDomain` and its `domainStatus`/`domainToken`/`domainError` fields, the `sites_domain` module, the `site.verify-domains` job, and the tenant "Your own domain" UI.
- Repurpose `GET /api/public/domains/check` (Caddy on-demand TLS `ask`) for white-label domains instead.
- Keep `src/lib/sites/domains.ts` verification machinery for reuse in C.

### C. White-label custom domain → branded login + app
- Add TXT-token verification + Caddy on-demand-TLS `ask` on `WhiteLabelConfig.customDomain` (Enterprise `white_label`).
- Middleware treats an active, verified white-label domain as an app host for that tenant; resolve brand by `Host` (logo, colors, appName, hideBranding).
- Auth/cookies: `danets_session` must be set/read on the tenant's own domain; CSP, cookie `secure`/scope and OAuth redirect URIs must accept configured white-label hosts.

## Deferred

- The platform-site **editor** (reusing the block machinery from `website-view.tsx`) — build only when platform-built landing pages are actually needed.