# Deployment Guide

## Prerequisites

- Node.js 20+
- MySQL 8+
- Copy `.env.example` to `.env` and fill in values

## First-time setup

```bash
npm install
cp .env.example .env
# Edit DATABASE_URL and other secrets in .env

npx prisma migrate deploy   # production
# or: npm run db:migrate    # development

npm run db:seed
npm run db:generate
npm run build
npm start
```

## Environment variables (required)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | MySQL connection string |
| `NEXT_PUBLIC_APP_URL` | Production | Used for payment callbacks |

## Environment variables (recommended for production)

| Variable | Purpose |
|----------|---------|
| `PAYSTACK_SECRET_KEY` | Live Paystack checkout + webhooks |
| `FLUTTERWAVE_SECRET_KEY` | Live Flutterwave checkout |
| `FLUTTERWAVE_SECRET_HASH` | Webhook verification |
| `EMAIL_PROVIDER` | `smtp` or `sendgrid` |
| `SMTP_*` or `SENDGRID_*` | Email delivery |
| `OPENAI_API_KEY` | AI chat features |
| `PAYMENT_CURRENCY` | Default `NGN` |
| `PAYMENT_USD_NGN_RATE` | USD plan price → NGN conversion |
| `REDIS_URL` | Shared rate limiting across instances (optional) |
| `CRON_SECRET` | Bearer token for `GET /api/cron/*` scheduled jobs (min 32 chars) |
| `JOB_CONCURRENCY` | Background jobs run in parallel per worker batch (default 4) |
| `JOB_POLL_MS` | Worker idle poll interval in ms (default 2000) |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server (port 3000) |
| `npm run build` | Production build (standalone output) |
| `npm start` | Run standalone server |
| `npm run db:migrate` | Apply migrations (dev) |
| `npm run db:seed` | Seed plans, demo tenant, platform admin |
| `npm run worker` | Background job worker (run as a second, long-lived process) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Job-queue tests against MySQL (needs `JOBS_TEST_DATABASE_URL`; wipes `test.*` jobs) |
| `npm run test:e2e` | Smoke tests (Playwright; server must be running) |

## Demo credentials (after seed)

- **Tenant:** `admin@danetstecpro.com` / `danets123` at `/`
- **Platform:** `superadmin@danetstecpro.com` / `super123` at `/platform`

## Production checklist

1. Set all secrets in `.env` (never commit `.env`)
2. Run `npx prisma migrate deploy`
3. Run `npm run db:seed` (or migrate data manually)
4. Configure Paystack/Flutterwave webhook URL: `https://your-domain/api/payments/webhook`
5. Set `EMAIL_PROVIDER=smtp` or `sendgrid` with valid credentials
6. Set `NEXT_PUBLIC_APP_URL=https://your-domain`
7. Run `npm run build` — TypeScript errors will block the build
8. Run `npm test` before deploy
9. Set `REDIS_URL` when running multiple app instances (shared rate limits)
10. Enable platform 2FA enforcement in Platform Settings → Security after all admins have TOTP enabled

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs on push/PR to `main`:
lint → typecheck → unit tests → build → migrate → seed → Playwright smoke tests.

## Two-factor authentication

- **Platform admins:** TOTP in Platform Settings → Security. When `enforcePlatform2fa` is on, login and active sessions require 2FA.
- **Tenant users:** Optional TOTP in Settings → Security. Prompted at sign-in when enabled.

## Scheduled retention

Purge audit logs, chat sessions, and leads older than each tenant's plan retention window.

**Endpoint:** `GET /api/cron/retention`  
**Auth:** `Authorization: Bearer <CRON_SECRET>`

```bash
# Example (weekly cron on your server)
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.com/api/cron/retention
```

Set `CRON_SECRET` in production `.env`. You can also run retention manually from Platform → Tenant Health → **Apply retention**, or via `POST /api/super-admin/bulk` with `{ "action": "apply_retention_all" }`.

**Vercel:** optional `vercel.json` cron (see repo `vercel.json`).

## Background jobs

Scheduled syncs, token refreshes and other async work run from a MySQL-backed queue (`Job` table, `src/lib/jobs`). Something must drain it — use one or both:

1. **Worker process (recommended for self-hosting):** `npm run worker` next to `npm start`, kept alive by systemd/pm2. Several workers can run at once; jobs are claimed with `SELECT … FOR UPDATE SKIP LOCKED`. On SIGTERM the worker finishes in-flight jobs (30s grace).
2. **Cron fallback (serverless):** call `GET /api/cron/jobs` every minute with `Authorization: Bearer <CRON_SECRET>`. It enqueues due scheduled jobs and runs queued jobs for ~45s. Already listed in `vercel.json` (per-minute crons need a paid Vercel plan).

```bash
# systemd example: ExecStart=/usr/bin/npm run worker  (WorkingDirectory = repo root)
# pm2 example:
pm2 start npm --name danets-worker -- run worker
```

Failed jobs retry with exponential backoff (30s, 1m, 2m … max 6h) up to their attempt limit, then move to `dead`. Platform → Tenant Health → **Background Jobs** shows queue depth and dead jobs, with Retry/Discard. Finished jobs are purged daily (succeeded after 14 days, dead after 30).

## Connected accounts (OAuth)

Tenants connect Meta (Facebook Pages, Instagram, Lead Ads) and Google (Search Console, Business Profile) from **Integrations → Connected accounts**. Only workspace admins can connect or disconnect. A provider shows as unavailable until its env vars are set.

1. **Meta:** create an app at developers.facebook.com (Business type) with Facebook Login for Business. Set `META_APP_ID` / `META_APP_SECRET` and add the redirect URI `{NEXT_PUBLIC_APP_URL}/api/connections/meta/callback`. Requested permissions (`pages_*`, `leads_retrieval`, `instagram_*`, `business_management`) need App Review before non-test users can grant them. For webhooks, subscribe the app to `{NEXT_PUBLIC_APP_URL}/api/webhooks/meta` with `META_WEBHOOK_VERIFY_TOKEN` as the verify token; payloads are checked against `META_APP_SECRET` and processed by the job queue.
2. **Google:** create an OAuth client (Web application) in Google Cloud Console, enable the Search Console and Business Profile APIs, set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and add the redirect URI `{NEXT_PUBLIC_APP_URL}/api/connections/google/callback`. Sensitive scopes need Google's OAuth verification for production.

Tokens are stored encrypted (same key as integration API keys). The hourly `connections.refresh` job renews Google tokens before they expire; Meta long-lived tokens (~60 days) can't be refreshed, so tenants get a reminder 7 days before expiry and the connection is marked expired afterwards. A revoked grant marks the connection revoked and notifies the tenant.

## Contacts and lead attribution

Every widget chat, lead and ticket is linked to a unified **Contact** (matched by email, phone or the widget's visitor id), and the widget records where the visitor came from as **touchpoints**: UTM tags, ad click ids (`gclid`, `msclkid`, `fbclid`, `li_fat_id`, …) and the referrer. A lead's **Source** is the channel of its first touch (`organic_search`, `paid_search`, `social_organic`, `social_paid`, `email`, `referral`, `direct`, `whatsapp`); leads from clients that send no attribution keep `chatbot`. Lead detail → **Journey** shows the timeline; Analytics → **Leads by Channel** charts it.

- **After deploying the `contacts_attribution` migration**, link existing records once (safe to re-run): `npm run contacts:backfill` (or `-- --business=<id>` for one tenant).
- **Consent:** sites that need cookie consent first embed the widget with `data-consent="required"` and call `window.Danets.consent(true)` once the visitor agrees (`consent(false)` clears stored attribution). Until then nothing is stored or sent.
- **Privacy:** landing and referrer URLs are stored without query strings or fragments. Anonymous touchpoints (visitor never became a contact) are purged with the plan's chat retention window; GDPR export includes contacts, identities and touchpoints.

## Payment flow

- Without gateway keys: local mock checkout at `/payment-checkout` (dev/test)
- With `PAYSTACK_SECRET_KEY` or `FLUTTERWAVE_SECRET_KEY`: redirects to provider hosted checkout
- Webhooks at `/api/payments/webhook` activate subscriptions automatically

## Troubleshooting

- **Prisma EPERM on Windows:** Stop the dev server, run `npx prisma generate`, restart
- **Login works but dashboard 500:** Run `npx prisma generate` after schema changes
- **Emails not sending:** Set `EMAIL_PROVIDER` and verify SMTP/SendGrid credentials via Platform → Email → Send test
- **PDF upload fails in dev:** Next.js Turbopack can block `pdf-parse` worker threads locally. Use TXT/DOCX in development, or run `npm run build && npm start` for production-mode PDF extraction. PDF works reliably in production Node runtime.
