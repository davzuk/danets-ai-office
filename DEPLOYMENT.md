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

## Social inbox

With **Inbox** switched on for a Page or Instagram account, Messenger and Instagram DMs and comments on the business's posts appear in **Conversations** (filter by channel). Each DM thread or top-level comment thread is a conversation; messages are deduplicated on Meta's ids, so webhook replays add nothing.

- **AI replies** per account (Integrations → Connected accounts): *off* notifies the team; *AI drafts replies* stores a suggested reply the team can send, edit or discard; *AI replies automatically* sends the knowledge-base-grounded reply. The first AI reply in a thread always says it comes from an AI assistant.
- The AI stays quiet for 30 minutes after a team member replies (in Danets or in Meta's own inbox), and stops completely when someone presses **Take over** or the customer asks for a person (the conversation moves to *handover*). **Resume AI** hands it back.
- Comments are classified (buying intent, question, complaint, spam, other). Only questions and buying intent get an AI reply; complaints notify the team; spam is left alone. Agents can reply publicly, send a private reply (opens a DM), or hide a comment.
- Meta's messaging window is enforced: anyone can reply within 24 hours of the customer's last message, team members can reply (sent with the `HUMAN_AGENT` tag) for up to 7 days, and after that replies are blocked until the customer writes again. `HUMAN_AGENT` needs the *Human Agent* permission in App Review.
- When someone types an email or phone number in a DM, a lead is created (`source` = first touch, usually `social_organic`); **Create lead** does the same by hand.
- WhatsApp stays on its own screen for now.

## Media library

**Media Library** (sidebar) stores the images and videos used in posts and ads. Every upload is type-checked by its bytes (not its name), limited to 8 MB per image (JPEG, PNG, WebP, GIF) and 100 MB per video (MP4, MOV, WebM), and counted against the plan's storage quota (`mediaStorageMbLimit`: Free 250 MB, Starter/Business 2 GB, Pro/Premium 10 GB, Enterprise 50 GB; overridable per tenant).

- Images are re-encoded with sharp: orientation applied, longest side capped at 2048 px, and all metadata (EXIF, GPS, camera details) removed. **Videos are stored as uploaded**, metadata included, because there is no ffmpeg step.
- `STORAGE_DRIVER=local` (default): files go to `STORAGE_LOCAL_DIR` (default `./storage/media`, git-ignored) and are served from `/api/media/files/...`. Use it for development or a single server with a persistent disk only; it doesn't work across several instances or on ephemeral filesystems.
- `STORAGE_DRIVER=s3`: any S3-compatible store (Cloudflare R2, AWS S3, DigitalOcean Spaces, MinIO). Set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` and, for AWS, `S3_REGION` (R2 uses `auto`). The bucket must be **publicly readable** at `S3_PUBLIC_URL` (on R2: a custom domain or the r2.dev URL), because Instagram and LinkedIn fetch post media by URL. File names carry 96 random bits, so links can't be guessed, but anyone who has a link can open it.
- Switching driver later doesn't move existing files; stored URLs keep pointing at the old location.
- Uploads go through the middleware, so `experimental.proxyClientMaxBodySize` in `next.config.ts` is raised to 105 MB. A reverse proxy in front (nginx `client_max_body_size`, Cloudflare's 100 MB limit on lower plans) must allow the same.
- The storage check runs per file, so two uploads at the same moment can overshoot the quota by up to one file each.
- Deleting a workspace from the platform console deletes its files from storage too.

## Content Studio

**Content Studio** (sidebar, Social Media module: Starter plan and up, behind the `social_hub` feature flag) turns one brief into ready-to-post copy for Facebook, Instagram, LinkedIn, X and TikTok. The flag is created switched off by the `content_studio` migration; turn it on in the platform console (globally or per tenant).

- Generation uses the `content` AI task with the tenant's Brand Voice and the most relevant knowledge base articles. The prompt forbids inventing prices, offers, statistics or testimonials.
- Every variant is checked against its platform's limits (Instagram 2,200 characters and 30 hashtags with no clickable links, LinkedIn 3,000, X 280 weighted with links counted as 23, and so on) and against the Brand Voice's "Never say" phrases. Failing variants are sent back to the model once. Anything still failing is fixed mechanically (offending sentences and hashtags removed, text trimmed, Instagram links replaced with "link in bio"), so a banned phrase or an over-limit post is never returned.
- Each AI call (including the one re-ask) is logged as `content_generate` and counts against the monthly AI quota; the Studio shows the credits left.
- Posts move through *draft* → *in review* → *approved*. Anyone can draft and send for approval; only admins approve. Editing or regenerating approved copy puts it back to draft. Approvals are recorded in the activity log.
- "Start from…" repurposes a knowledge base article or a question from a lead (the question only, never the lead's details).

### Calendar and publishing

Content Studio → **Calendar** shows scheduled posts by month or week in the tenant's time zone (phones get a list). Drag a post to another day to move it; the time of day is kept. **Schedule** on a post picks, per platform, a connected account or "post by hand", and a time (or *Publish now*).

- **Automatic publishing:** Facebook Pages, Instagram business accounts and LinkedIn Pages connected under Settings → Connections with *Publishing* on. X and TikTok (and any platform without a connected account) become reminders: at the time, the team is notified, copies the text from the calendar and clicks *Mark posted*.
- Each scheduled post queues a `social.publish` job for its time, so **a worker or the `/api/cron/jobs` cron must be running** (see Background jobs). Throttling and Meta outages retry with backoff (5 attempts); a revoked token marks the account as needing reconnection and fails the post with a notification; content Meta rejects fails straight away with Meta's reason. A run interrupted mid-publish is marked failed rather than retried, so nothing posts twice.
- **Media for Facebook and Instagram must be at a public URL** Meta can fetch (LinkedIn is sent the file itself): use `STORAGE_DRIVER=s3` (or local storage behind a public `NEXT_PUBLIC_APP_URL`). Instagram needs at least one image or video, images between 4:5 and 1.91:1, and at most 25 posts per account per 24 hours; non-JPEG images are converted to a JPEG copy stored next to the original.
- **Approval policy and time zone:** Calendar → Settings (admins). *Automatic* (default) needs approval only when the workspace has more than one person; *Admins approve members' posts*; *Every post needs approval*; or *No approval*. A post scheduled before approval waits on the calendar and goes out when an admin approves it (straight away if its time has passed). Editing approved copy sends it back for approval; due posts that aren't approved are held, not published.

### Engagement analytics

Content Studio → **Analytics** shows, for posts published through Danets: views, engagements and engagement rate per platform, a daily trend, top posts by engagement rate and by leads, the best weekday and time to post (in the tenant's time zone), and follower growth.

- **Metrics sync:** each published post gets a `social.metrics-post` snapshot 1 hour, 24 hours, 72 hours and 7 days after publishing, then weekly to 5 weeks. `social.metrics-account` records follower counts daily (02:15 UTC). Both need the worker or cron. Sources: Facebook `/{post-id}/insights` (`post_media_view`, `post_total_media_view_unique`, `post_clicks`) plus reactions, comments and shares; Instagram `/{media-id}/insights` (`views`, `reach`, `total_interactions`, …); LinkedIn `organizationalEntityShareStatistics` and `networkSizes`. Meta replaced "impressions" with "views" in 2025; metrics a Page or media type doesn't support are skipped rather than failing the sync.
- **Permissions:** Meta needs `read_insights` and `instagram_manage_insights` (in the default scopes; include them in App Review). LinkedIn uses `r_organization_social` / `rw_organization_admin` from the Community Management API.
- **Leads per post:** links in published posts are tagged automatically: `utm_source=<platform>&utm_medium=social&utm_campaign=<campaign tag, or post-<id>>&utm_content=<scheduled post id>`. Tags the author already set are kept. When the website widget records a visit through that link and the visitor later becomes a lead, the lead counts toward the post. Posts marked as posted by hand have no metrics.
- **Weekly insight:** Mondays 06:00 UTC, `social.insights-weekly` queues a note for each tenant that published in the last 4 weeks. The AI (`plan` task, one credit) reads the numbers with the brand voice and writes what worked, what didn't, and three post ideas that open prefilled in the Studio. It's shown on the dashboard and sent as a *Weekly Content Insight* notification (by email for users who turn email on for it). Admins can refresh it from the dashboard.

## LinkedIn

Tenants connect LinkedIn under Integrations; every Page the member administers becomes a LinkedIn Page account with *Publishing* and *Lead Ads* switches.

1. Create an app at linkedin.com/developers, associated with Danets' verified LinkedIn Page. Add the redirect URL `{NEXT_PUBLIC_APP_URL}/api/connections/linkedin/callback` and set `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.
2. Add the **Sign In with LinkedIn using OpenID Connect** product, and apply for the **Community Management API** (Page posting: `w_organization_social`, `r_organization_social`, `rw_organization_admin`). Until it is approved only the app's developers can connect.
3. Apply separately for the **Lead Sync API**. Once approved, set `LINKEDIN_LEAD_SYNC=true` (adds `r_marketing_leadgen_automation`) and have tenants reconnect.
4. Keep `LINKEDIN_API_VERSION` (YYYYMM) current: LinkedIn retires versions about a year after release, and requests on a retired version fail.

- **Tokens:** posts and lead reads use the connecting member's token. It lasts 60 days; apps approved for the Community Management API also get a 365-day refresh token, which the hourly `connections.refresh` job uses. Without one, tenants get the usual "reconnect" notice before expiry. If the member loses admin rights on a Page, reconnecting removes it.
- **Publishing:** text, a link card, up to 20 images, or one video. Images and video are uploaded to LinkedIn directly, so local storage works.
- **Lead Gen Forms:** with *Lead Ads* on, the `linkedin.leadgen-poll` job runs every 15 minutes (worker or cron required) and backfills 90 days the first time. Leads go through the same import as Meta lead ads: `externalRef = linkedin:<response id>`, an `ad_lead` touchpoint (`social_paid`, `li_fat_id` when the form passes it as a hidden field), merged by email, counted against the lead quota. Forms appear under Leads → Lead forms with the same field mapping. If LinkedIn refuses lead access, sync is switched off for that Page and the tenant is told why.

## Chat widget on tenant websites

Tenants paste `<script src="{NEXT_PUBLIC_APP_URL}/widget.js?pk=<publicKey>" async></script>` into their own site. The script sends its API calls to the origin it was loaded from (with `NEXT_PUBLIC_APP_URL` as the fallback), so `NEXT_PUBLIC_APP_URL` must be the public HTTPS address of the app.

- **CORS:** `/api/public/chat`, `/lead`, `/track` and `/widget` answer preflight and allow the calling origin, with no credentials (the widget uses no cookies). `/api/public/contact` is the Danets site's own form and stays same-origin.
- **Allowed websites:** Widget Embed → *Allowed websites* locks a tenant's public key to its own hosts (`example.com` also covers `www.`; `*.example.com` covers every subdomain). Calls from other websites get 403 `ORIGIN_NOT_ALLOWED` and the widget hides itself. Chats and leads are refused at once; a browser that loaded the widget config in the last minute keeps showing the button until its cached copy (`private, max-age=60`) expires. The app's own origin is always allowed so the dashboard preview and `/widget-demo` keep working. Calls without an `Origin` header aren't blocked, since only browsers send it. Super admins can see and clear the list on the tenant page.
- **Tenant CSP:** a site that sends a `Content-Security-Policy` header must allow the app's origin in `script-src` and `connect-src`. Widget Embed shows the lines.
- **Page context:** each chat message carries the page URL (origin + path, query stripped) and title. The AI uses them as context only, and Conversations shows the page a chat started on.
- **Proactive messages (Starter+):** AI Agent → *Proactive messages* holds up to 20 rules (pages, trigger on load / time / scroll / exit intent, new or returning visitors, device, how often). The widget shows the highest-priority match as a bubble, or opens the chat on computers. "Shown" comes from `/api/public/widget/event` (counted once per visitor per rule every 30 minutes); chats and leads are counted server-side from the session's `widgetRuleId`. Frequency caps live in the visitor's browser storage, so in `data-consent="required"` mode rules wait for `consent(true)`.
- **Pre-chat form:** AI Agent → *Pre-chat form* asks for name plus email / phone / company before the first message. The widget starts the session with `/api/public/session` and creates the lead at once; an optional consent checkbox saves the agreed wording on the lead's timeline (type `consent`). Each new lead is AI-scored, so it uses the tenant's AI quota as other leads do.

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
