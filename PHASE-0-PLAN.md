# Phase 0 — Foundations for the Lead-Gen & Marketing Hub

**Date:** 2026-11-21
**Goal:** Build the five foundations every later phase depends on (social lead sync, social inbox, SEO, campaign hub) without adding new required infrastructure. MySQL stays the only datastore.

| # | Workstream | Unblocks | Est. (1 dev) |
|---|---|---|---|
| A | AI provider layer | Every AI generator, cost tracking, streaming | 4–5 days |
| B | Background job queue | Scheduled posts, syncs, crawls, token refresh, sequences | 3–4 days |
| C | OAuth connection framework | Meta / LinkedIn / Google integrations | 4–5 days (+ external app-review lead time) |
| D | Contact + attribution | Lead-source reporting, 360° timeline, campaign ROI | 5–7 days |
| E | Brand Voice profile | All AI content generation | 2–3 days |

**Order:** A and B in parallel first → C (needs B for token refresh) and D (independent) → E (needs A, uses B).
**Total:** about 3–4 weeks for one developer. Submit Meta/LinkedIn app reviews in week 1, because approval takes weeks.

---

## A. AI provider layer

### Problem today
- `src/lib/ai.ts` hard-wires `z-ai-web-dev-sdk`. The tenant's `Integration` row with `category = "ai_provider"` is stored and tested (`src/lib/integration-test.ts`), but `aiChat()` never uses it.
- Cost is a flat `$0.002 / 1K tokens` (`logUsage`), and `AiUsageLog` records no model or provider.
- No streaming and no structured (JSON-schema) output. 12 call sites parse free text.
- 10 call sites pass `temperature`. Current Claude models reject sampling parameters (400), so adapters must drop them.

### Design
```
src/lib/llm/
  index.ts            // public API: aiChat, aiStream, aiStructured, (later) aiEmbed
  types.ts            // AiTask, AiRequest, AiResult, ProviderAdapter interface
  resolve.ts          // (businessId, task) -> { adapter, model, credentials }
  pricing.ts          // per-model $/1M input & output, cache-read rate
  usage.ts            // logUsage(businessId, feature, provider, model, usage)
  providers/
    anthropic.ts      // @anthropic-ai/sdk (default)
    openai.ts         // for tenants who bring an OpenAI key
    zai.ts            // current SDK, kept as a legacy fallback
```

- **Tasks, not models, at call sites:** `task: "chat" | "classify" | "extract" | "content" | "plan"`. `resolve.ts` maps task → model per provider, and a tenant can override it in their `ai_provider` integration config.
- **Default model:** `claude-opus-5-5` for every task. Moving cheaper tasks (classify, extract, widget chat) to `claude-sonnet-5-5` or `claude-haiku-5-5` is a cost decision (see open decisions below). The task map makes it a one-line change later.
- **Credential resolution order:** an active tenant `ai_provider` integration (key decrypted with `decryptApiKey` from `src/lib/crypto.ts`) → platform default (`AI_DEFAULT_PROVIDER` + `ANTHROPIC_API_KEY` env vars) → `zai` legacy.
- **Anthropic adapter specifics:**
  - Don't send `thinking: disabled` or `temperature`; Opus 5.5 rejects both. Control depth with `output_config.effort` per task (`low` for chat/classify, `medium` for content, `high` for plan).
  - `aiStructured()` uses `output_config.format` with a JSON schema (Zod → JSON Schema). Use it to replace regex parsing in `ai-scoring.ts`, quotes generation and ticket AI.
  - `aiStream()` uses `client.messages.stream()`. Wire it to `/api/public/chat` as SSE in a follow-up.
  - Enable server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) and always check `stop_reason` before reading content.
  - Put the system prompt and brand/KB context first with `cache_control` for prompt caching.
- **Pricing table** (`pricing.ts`, values are $/1M tokens, input/output): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50. OpenAI and z-ai rows are filled from their pricing pages. Keep this table editable by the platform admin later.
- **Backwards compatibility:** `aiChat(messages, opts)` in `src/lib/ai.ts` stays as a shim that delegates to `src/lib/llm/index.ts`, so the 12 callers keep working. Then migrate them one by one to pass `{ businessId, task, feature }`.

### Schema
```prisma
model AiUsageLog {
  // + new columns
  provider         String  @default("zai")
  model            String?
  cacheReadTokens  Int     @default(0)
  latencyMs        Int?
}
```

### Files touched
`src/lib/ai.ts` (shim), new `src/lib/llm/**`, `src/lib/ai-scoring.ts`, the 12 routes listed by `grep -rn "aiChat(" src`, `src/lib/integration-test.ts` (add an Anthropic key test), the integrations view (model/task override fields), `package.json` (`@anthropic-ai/sdk`).

### Done when
- With no tenant integration, chat runs on the platform Anthropic key; with a tenant OpenAI key, it runs on OpenAI.
- `AiUsageLog` rows show provider, model and correct cost.
- Lead scoring uses `aiStructured` with no text parsing.
- Unit tests cover the resolver, the pricing math and adapter request shaping (no `temperature` sent to Anthropic). Provider SDKs are mocked.

---

## B. Background job queue (MySQL-backed)

### Why not Redis/BullMQ
The `redis` package is in `package.json` but nothing in `src/` uses it, and deployment is plain Node + MySQL (`DEPLOYMENT.md`, `Caddyfile`). A DB-backed queue using MySQL 8's `FOR UPDATE SKIP LOCKED` covers the expected volume with no new infrastructure. The `enqueue`/handler API stays the same if we move to BullMQ later.

### Schema
```prisma
model Job {
  id          String    @id @default(cuid())
  businessId  String?
  type        String              // e.g. "connection.refresh", "brand.generate"
  payload     Json
  status      String    @default("queued") // queued | running | succeeded | failed | dead
  runAt       DateTime  @default(now())
  attempts    Int       @default(0)
  maxAttempts Int       @default(5)
  lockedAt    DateTime?
  lockedBy    String?
  lastError   String?   @db.Text
  dedupeKey   String?   @unique  // idempotent enqueue, recurring windows
  createdAt   DateTime  @default(now())
  finishedAt  DateTime?

  @@index([status, runAt])
  @@index([businessId])
}
```

### Design
```
src/lib/jobs/
  queue.ts        // enqueue(type, payload, { runAt, dedupeKey, businessId }), claimBatch(), complete(), fail()
  registry.ts     // type -> handler, typed with Zod payload schemas
  schedules.ts    // recurring jobs in code: { type, cron } -> enqueued with dedupeKey `${type}:${window}`
  runner.ts       // runOnce(limit): claim -> run handler inside logger request context -> complete/fail
  handlers/       // one file per job type
scripts/worker.ts // long-running loop: runner.runOnce every 2s, schedules tick every 60s, graceful SIGTERM
src/app/api/cron/jobs/route.ts // serverless fallback: protected by cron-secret, runs runOnce(25)
```
- **Claiming:** in a transaction, `SELECT id FROM Job WHERE status='queued' AND runAt<=NOW() ORDER BY runAt LIMIT ? FOR UPDATE SKIP LOCKED`, then set `running` + `lockedAt`/`lockedBy`.
- **Retries:** exponential backoff (`runAt = now + 2^attempts * 30s`). After `maxAttempts` the job goes to `dead` and the super-admin health panel gets a notification.
- **Stale-lock reaper:** jobs stuck `running` for more than 10 minutes go back to `queued`.
- **Logging:** each run gets a request ID through the existing AsyncLocalStorage logger.
- **Retention:** extend `/api/cron/retention` to purge succeeded jobs older than 14 days.
- `package.json`: `"worker": "tsx scripts/worker.ts"`. `DEPLOYMENT.md`: run the worker as a second process (systemd/pm2). `vercel.json`: add `/api/cron/jobs` every minute.
- Later candidate: move `fireTrigger` in `src/lib/automation.ts` onto the queue so automations stop running inline in request handlers. Not required for Phase 0.

### Done when
- Two worker processes never run the same job (concurrency test against a real MySQL).
- A failing handler retries with backoff and ends as `dead`.
- Super-admin can see queue depth and dead jobs in the health panel.

---

## C. OAuth connection framework

`Integration` holds API-key config as a JSON blob. OAuth needs refreshable tokens, scopes, connected-account identity and health, so it gets its own model instead of overloading `Integration.config`.

### Schema
```prisma
model OAuthConnection {
  id              String    @id @default(cuid())
  businessId      String
  provider        String              // meta | linkedin | google | x | tiktok
  externalAccountId String
  accountName     String?
  scopes          String    @db.Text  // space-separated granted scopes
  accessToken     Json                // EncryptedPayload (src/lib/crypto.ts)
  refreshToken    Json?               // EncryptedPayload
  expiresAt       DateTime?
  status          String    @default("active") // active | expired | revoked | error
  lastError       String?
  metadata        Json?               // e.g. Meta pages + page tokens, GSC properties
  connectedById   String?             // BusinessUser id
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([businessId, provider, externalAccountId])
  @@index([businessId])
  @@index([status, expiresAt])
}
```

### Design
```
src/lib/connections/
  types.ts          // ProviderDefinition: authorizeUrl(), exchangeCode(), refresh(), revoke(), fetchAccount()
  registry.ts
  tokens.ts         // getAccessToken(connectionId): decrypts, refreshes if <5 min to expiry, persists
  state.ts          // signed, short-lived OAuth state (businessId, userId, provider, nonce, PKCE verifier)
  providers/meta.ts     // first provider: Pages, Instagram, Lead Ads scopes
  providers/google.ts   // second: Search Console + Business Profile scopes (used in Phase 3)
src/app/api/connections/route.ts                    // GET list (no tokens returned)
src/app/api/connections/[provider]/start/route.ts   // admin-only, redirects to provider
src/app/api/connections/[provider]/callback/route.ts
src/app/api/connections/[id]/route.ts               // DELETE: revoke + delete
src/lib/jobs/handlers/connection-refresh.ts         // recurring: refresh tokens expiring in <24h, mark failures
```
- Platform-level OAuth apps: `META_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET`. Tenants never create their own apps.
- **Security:** PKCE where supported, state bound to the session, tokens encrypted at rest, admin role plus TOTP re-auth (`src/lib/reauth.ts`) to connect/disconnect, audit-log entries for both, and a CSP `connect-src`/`form-action` review in `next.config.ts`.
- **Webhooks receiver scaffold:** `/api/webhooks/[provider]` with signature verification (`src/lib/webhook-signatures.ts`). It enqueues a job and returns 200 immediately. Phase 1 Meta Lead Ads plugs in here.
- **UI:** a "Connected accounts" section in the Integrations view showing status and scopes, with Reconnect and Disconnect buttons.
- **External prerequisites (start week 1):** Meta App Review for `pages_manage_metadata`, `leads_retrieval`, `pages_messaging`, `instagram_manage_messages`; the LinkedIn Marketing Developer Platform application; Google OAuth consent-screen verification. Each needs a privacy policy URL and a demo video. The marketing `legal/` pages can host the policy.

### Done when
- A tenant admin can connect and disconnect a Meta account in dev mode.
- Tokens refresh automatically, and an expired or revoked token flips status to `error` and notifies the admin.
- Tokens never appear in API responses or logs.

---

## D. Contact + attribution

### Problem today
Lead, ChatSession visitor, SupportTicket requester and QuoteRequest client are separate records. Nothing records where a visitor came from, and `Lead.source` is set by hand (`"chatbot"` in `/api/public/lead`).

### Schema
```prisma
model Contact {
  id          String   @id @default(cuid())
  businessId  String
  name        String?
  email       String?
  phone       String?
  company     String?
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  consent     Json?    // { marketingEmail, whatsapp, sms: { granted, at, source } }
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  business    Business          @relation(fields: [businessId], references: [id], onDelete: Cascade)
  identities  ContactIdentity[]
  touchpoints Touchpoint[]
  leads       Lead[]
  // + chatSessions, supportTickets, quoteRequests back-relations

  @@unique([businessId, email])
  @@index([businessId, phone])
}

model ContactIdentity {
  id         String @id @default(cuid())
  businessId String
  contactId  String
  type       String // visitor | email | phone | whatsapp | fb_psid | ig_id | linkedin
  value      String
  contact    Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@unique([businessId, type, value])
}

model Touchpoint {
  id          String   @id @default(cuid())
  businessId  String
  contactId   String?
  visitorId   String?
  kind        String   // visit | chat_start | form_submit | ad_lead | social_dm | email_click
  channel     String   // organic_search | paid_search | social_organic | social_paid | email | referral | direct | whatsapp
  source      String?  // utm_source / referrer host / platform
  medium      String?
  campaign    String?
  term        String?
  content     String?
  clickId     String?  // gclid | fbclid | li_fat_id | msclkid
  landingUrl  String?  @db.Text
  referrer    String?  @db.Text
  occurredAt  DateTime @default(now())

  contact Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  @@index([businessId, occurredAt])
  @@index([contactId])
  @@index([visitorId])
}
```
Plus nullable `contactId` on `Lead`, `ChatSession`, `SupportTicket` and `QuoteRequest`, and `firstTouchId`/`lastTouchId` on `Lead`. Extend the `Lead.source` comment/values with `meta_lead_ads | linkedin_lead_gen | google_ads | organic_search | social_organic | email | direct`.

### Design
- `src/lib/contacts.ts`: `resolveContact(businessId, identities[], profile)`. Find by any identity, merge identities, update `lastSeenAt`, and create if missing, all in one transaction. On a conflict where two contacts match, merge into the older one and re-point the related rows.
- `src/lib/attribution.ts`: `classifyChannel({ utm, referrer, clickId })` (search-engine host list → organic_search; `gclid`/`msclkid` → paid_search; fbclid/known social hosts → social; and so on). Also `recordTouch()`.
- **Widget (`src/app/widget.js/route.ts`):** on load, read UTM params, click IDs, `document.referrer` and the landing URL. Store first-touch in `localStorage` (`danets_ft`) and last-touch per browser session. Send an `attribution` object with the `/api/public/chat` and `/api/public/lead` calls. Respect a consent hook (`data-consent="required"` → wait until `window.Danets.consent(true)`).
- **New `POST /api/public/track`** (pk-authenticated, rate-limited): records one `visit` touchpoint per visitor session, not per pageview, to keep volume low.
- `/api/public/lead` and `/api/public/chat` call `resolveContact` and `recordTouch`, and set `Lead.source` from the classified channel instead of hard-coding `"chatbot"`.
- **Backfill script** `scripts/backfill-contacts.ts`: build contacts from existing leads (email/phone), chat sessions (visitorId/email) and tickets. Idempotent and batched.
- **GDPR and retention:** `/api/gdpr/export` and `/api/gdpr/delete` include Contact, ContactIdentity and Touchpoint. `/api/cron/retention` prunes anonymous touchpoints older than the retention window.
- **UI:** a source/channel column and filter on Leads, a "Journey" tab on lead detail (touchpoints timeline), and a "Leads by channel" chart in Analytics.

### Done when
- Visiting `/?utm_source=facebook&utm_campaign=bf26`, chatting and leaving an email creates one Contact, a Lead with `source = social_paid` and a first-touch campaign of `bf26`.
- A returning visitor with the same email reuses the same Contact.
- The backfill runs twice without creating duplicates.
- There's an e2e test for this whole flow.

---

## E. Brand Voice profile

### Schema
```prisma
model BrandProfile {
  id            String   @id @default(cuid())
  businessId    String   @unique
  summary       String?  @db.Text   // one-paragraph who-we-are
  audience      Json?               // [{ segment, pains, desires }]
  tone          Json?               // { adjectives: [], formality: 1-5, emoji: bool }
  valueProps    Json?
  offers        Json?               // [{ name, price?, cta, url? }]
  doPhrases     Json?
  dontPhrases   Json?
  locales       Json?               // ["en-NG", "fr"]
  websiteUrl    String?
  source        String   @default("manual") // manual | generated | edited
  generatedAt   DateTime?
  updatedAt     DateTime @updatedAt
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}
```

### Design
- `GET/PUT /api/brand-profile` (admin edits) and `POST /api/brand-profile/generate`, which enqueues a `brand.generate` job.
- The `brand.generate` handler reads the business record, its active KB items and the AI agent persona (and website text once the Phase 2 crawler exists). It calls `aiStructured({ task: "plan" })` with a Zod schema matching the model, saves `source = generated`, and notifies the admin to review.
- `src/lib/brand.ts`: `buildBrandContext(businessId)` returns a stable, deterministic text block for system prompts (good for prompt caching). Every Phase 1+ generator must use it; the widget agent can optionally use it too.
- **UI:** Settings → "Brand Voice" tab with a "Generate from my knowledge base" button, editable fields and a "Preview a sample post" button.
- Add a step to the onboarding checklist: "Set your brand voice".

### Done when
- A tenant with a populated KB can generate, edit and save a profile.
- `buildBrandContext` output is byte-identical across calls when nothing changed (unit test).

---

## Cross-cutting

- **Plan gating:** Phase 0 is infrastructure, so there are no new paid modules yet. Connections and brand generation are available on all plans; quota-limit AI calls through the existing `requireQuota` and `AiUsageLog`. Add `social`, `seo` and `campaigns` module keys to `src/lib/module-registry.ts` now (hidden) so Phase 1+ can be gated by plan.
- **Migrations:** one Prisma migration per workstream (`2026xxxx_ai_usage_model`, `_jobs`, `_oauth_connections`, `_contacts_attribution`, `_brand_profile`), all additive and nullable, so nothing breaks while they roll out.
- **Docs:** update `DEPLOYMENT.md` (worker process, new env vars), `.env.example` and `README.md` (AI provider section).
- **Tests:** unit tests for each lib module; integration tests for queue concurrency and contact merge against MySQL; one e2e for widget attribution → lead.

## Open decisions (owner: product)

1. **Model tiers.** Default everything to `claude-opus-5-5`, or route high-volume tasks (widget chat, classification, scoring) to `claude-sonnet-5-5` / `claude-haiku-5-5` to cut cost? The task map supports either.
2. **z-ai SDK:** keep it as a fallback provider, or remove it once Anthropic is live?
3. **Worker hosting:** self-hosted second process (recommended, matches `Caddyfile`/standalone build) or Vercel cron only? Both configs exist today.
4. **First OAuth provider:** Meta (Lead Ads + Messenger/Instagram inbox) is recommended as the quickest real lead source. Google is second, for Phase 3 SEO.
5. **Embeddings provider** (for replacing TF-IDF retrieval later): Anthropic doesn't offer an embeddings endpoint, so this needs Voyage AI or OpenAI. Deferred; not needed for Phase 0.
