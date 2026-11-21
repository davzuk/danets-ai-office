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
| `ANTHROPIC_API_KEY` | Platform default AI (Claude, `claude-opus-5-5` for every task) |
| `AI_DEFAULT_PROVIDER` | `anthropic` \| `openai` \| `zai`; unset = `anthropic` when its key is set, else `zai` |
| `AI_DEFAULT_MODEL` / `AI_MODEL_<TASK>` | Optional model overrides (tasks: `CHAT`, `CLASSIFY`, `EXTRACT`, `CONTENT`, `PLAN`) |
| `OPENAI_API_KEY` + `OPENAI_DEFAULT_MODEL` | Platform OpenAI default (both required) |
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

1. **Meta:** create an app at developers.facebook.com (Business type) with Facebook Login for Business. Set `META_APP_ID` / `META_APP_SECRET` and add the redirect URI `{NEXT_PUBLIC_APP_URL}/api/connections/meta/callback`. Requested permissions (`pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `pages_manage_posts`, `pages_manage_engagement`, `pages_read_user_content`, `read_insights`, `leads_retrieval`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`, `instagram_manage_insights`, `business_management`) need App Review before non-test users can grant them; override the list with `META_OAUTH_SCOPES` while a review is pending.
   - **Webhooks** (App Dashboard → Webhooks): callback `{NEXT_PUBLIC_APP_URL}/api/webhooks/meta`, verify token `META_WEBHOOK_VERIFY_TOKEN`. Subscribe the **Page** object to `leadgen`, `messages`, `messaging_postbacks` and `feed`, and the **Instagram** object to `messages` and `comments`. Payloads are checked against `META_APP_SECRET` and processed by the job queue. Each connected Page is also subscribed to the app automatically (`social.subscribe` job) and unsubscribed on disconnect.
   - **Facebook Login settings:** Deauthorize callback URL `{NEXT_PUBLIC_APP_URL}/api/webhooks/meta/deauthorize`; Data Deletion Request URL `{NEXT_PUBLIC_APP_URL}/api/webhooks/meta/data-deletion`. Deauthorize marks the user's connections and accounts revoked; data deletion removes them and returns a status page at `/data-deletion/<code>`.
   - Connecting creates one **social account** per Page and linked Instagram account. Lead Ads sync and the inbox are **off** by default; admins switch them on per account under Integrations → Connected accounts. A Page already connected to another workspace is skipped and the admin is warned.
2. **Google:** create an OAuth client (Web application) in Google Cloud Console, enable the Search Console and Business Profile APIs, set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and add the redirect URI `{NEXT_PUBLIC_APP_URL}/api/connections/google/callback`. Sensitive scopes need Google's OAuth verification for production.

Tokens are stored encrypted (same key as integration API keys). The hourly `connections.refresh` job renews Google tokens before they expire; Meta long-lived tokens (~60 days) can't be refreshed, so tenants get a reminder 7 days before expiry and the connection is marked expired afterwards. A revoked grant marks the connection revoked and notifies the tenant.

## Meta Lead Ads

With **Lead Ads** switched on for a Page (Integrations → Connected accounts), each Lead Ads submission becomes a Lead:

- The `leadgen` webhook queues `meta.leadgen`, which fetches the lead with the Page token, maps its answers (Leads → **Lead forms** → Fields), records an `ad_lead` touchpoint with the campaign, ad set and ad names, and creates the lead with `source` = `social_paid` (or `social_organic` for organic forms). Then the usual notification, `new_lead` automations and AI scoring run.
- Leads are idempotent on `Lead.externalRef = meta:<leadgen_id>`, so webhook retries and the poller never duplicate. A submission by an email that already has a lead adds an activity to that lead instead.
- The hourly `meta.leadgen-poll` job lists each Page's forms and fetches leads the webhook missed. Switching Lead Ads on for a Page runs it immediately and backfills the last 90 days (Meta's retention). Admins can also press **Check for leads now**.
- Ad leads count against the plan's `leads` quota. When it's used up the lead is not imported, the tenant is notified, and the job is left dead in the queue; a platform admin can retry it from the Jobs card after the tenant upgrades.
- Test with Meta's [Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing). The app needs `leads_retrieval` and the Page must grant the app lead access (Meta Business Suite → Settings → Leads access).

## Contacts and lead attribution

Every widget chat, lead and ticket is linked to a unified **Contact** (matched by email, phone or the widget's visitor id), and the widget records where the visitor came from as **touchpoints**: UTM tags, ad click ids (`gclid`, `msclkid`, `fbclid`, `li_fat_id`, …) and the referrer. A lead's **Source** is the channel of its first touch (`organic_search`, `paid_search`, `social_organic`, `social_paid`, `email`, `referral`, `direct`, `whatsapp`); leads from clients that send no attribution keep `chatbot`. Lead detail → **Journey** shows the timeline; Analytics → **Leads by Channel** charts it.

- **After deploying the `contacts_attribution` migration**, link existing records once (safe to re-run): `npm run contacts:backfill` (or `-- --business=<id>` for one tenant).
- **Consent:** sites that need cookie consent first embed the widget with `data-consent="required"` and call `window.Danets.consent(true)` once the visitor agrees (`consent(false)` clears stored attribution). Until then nothing is stored or sent.
- **Privacy:** landing and referrer URLs are stored without query strings or fragments. Anonymous touchpoints (visitor never became a contact) are purged with the plan's chat retention window; GDPR export includes contacts, identities and touchpoints.

## Brand Voice

Settings → **Brand Voice** holds each tenant's profile (summary, audience, tone, value props, offers, phrases to use and avoid, languages). Admins can draft it with AI from their active knowledge-base articles: **Generate from my knowledge base** queues a `brand.generate` job, so a worker or the `/api/cron/jobs` cron must be running (see Background jobs). It uses the `plan` AI task, counts against the tenant's monthly AI quota, and notifies the tenant when the draft is ready to review. **Preview a sample post** writes one Facebook, Instagram, LinkedIn or X post from the current (unsaved) edits.

Code that generates content must put `getBrandContext(businessId)` from `src/lib/brand.ts` in its system prompt. The block is deterministic, so it caches well as a prompt prefix.

## Payment flow

- Without gateway keys: local mock checkout at `/payment-checkout` (dev/test)
- With `PAYSTACK_SECRET_KEY` or `FLUTTERWAVE_SECRET_KEY`: redirects to provider hosted checkout
- Webhooks at `/api/payments/webhook` activate subscriptions automatically

## Troubleshooting

- **Prisma EPERM on Windows:** Stop the dev server, run `npx prisma generate`, restart
- **Login works but dashboard 500:** Run `npx prisma generate` after schema changes
- **Emails not sending:** Set `EMAIL_PROVIDER` and verify SMTP/SendGrid credentials via Platform → Email → Send test
- **PDF upload fails in dev:** Next.js Turbopack can block `pdf-parse` worker threads locally. Use TXT/DOCX in development, or run `npm run build && npm start` for production-mode PDF extraction. PDF works reliably in production Node runtime.
