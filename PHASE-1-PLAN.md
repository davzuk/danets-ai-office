# Phase 1: Social Lead Generation

**Date:** 2026-11-21
**Goal:** Turn tenants' Facebook, Instagram and LinkedIn presence into a measurable lead source, managed from Danets. Leads arrive automatically from ad forms and DMs, the AI answers in the brand voice, and tenants plan, approve and publish content from one calendar.
**Builds on Phase 0:** AI provider layer (A), job queue (B), OAuth connections (C), contacts and attribution (D), Brand Voice (E). All of it is on `feat/oauth-connections`.

| # | Workstream | Delivers | Est. (1 dev) |
|---|---|---|---|
| F | Meta platform plumbing | Page webhook subscription, scopes, data-deletion and deauthorize callbacks, per-page settings | 3–4 days |
| G | Meta Lead Ads sync | Facebook/Instagram lead forms → `Lead` + Contact + touchpoint, in real time with a poll fallback | 4–5 days |
| H | Social inbox | Messenger + Instagram DMs and comments in Conversations; AI replies from the KB; leads from intent | 7–9 days |
| I | Media library | Uploads + public URLs for post images (Instagram needs them) | 2–3 days |
| J | AI Content Studio | One brief → per-platform posts in the brand voice, with hashtags and image | 5–6 days |
| K | Calendar, approval and publishing | Drag-and-drop calendar, approval step, scheduled auto-publish to FB/IG/LinkedIn | 7–9 days |
| L | LinkedIn | OAuth provider, Page publishing, Lead Gen Forms sync | 4–5 days (+ LinkedIn approval) |
| M | Engagement analytics | Post metrics sync, dashboard, weekly AI "what worked / what next" | 4–5 days |

**Order:** F first (everything Meta needs it) → G (fastest real leads) → H → I → J → K. L can start any time after F, but it can't go live until LinkedIn approves the app. M needs K (published posts to measure).
**Total:** about 7–9 weeks for one developer, or 4–5 weeks with two (one on F→G→H, one on I→J→K).

**External lead time (start in week 1):**
- **Meta App Review:** for every permission listed in F, plus Business Verification. Allow 2–6 weeks, and plan for at least one rejection round. Reviewers need a screencast of each permission in use, so build F/G/H against a test Page and record as you go.
- **LinkedIn:** Community Management API (Page posting) and Lead Sync API (lead forms) are separate applications. Each takes weeks and needs a verified LinkedIn Page for Danets.
- **Official APIs only.** No scraping or unofficial automation: it breaks platform terms and gets tenants' accounts banned.

---

## F. Meta platform plumbing

### Problem today
Workstream C connects a Meta user and stores their Pages with page tokens, but:
- Pages are never subscribed to the app's webhooks, so no `leadgen` or `messages` events arrive.
- The default scopes can't publish posts, manage comments or read insights.
- Meta App Review requires data-deletion and deauthorize callbacks, and we have neither.

### Schema
```prisma
model SocialAccount {           // one publishable/inbox-able asset
  id             String   @id @default(cuid())
  businessId     String
  connectionId   String           // OAuthConnection that owns the token
  platform       String           // facebook_page | instagram | linkedin_page
  externalId     String           // Page id / IG business account id / LinkedIn org URN
  name           String
  username       String?
  pictureUrl     String?  @db.Text
  accessToken    Json?            // encrypted page token (FB/IG); null = use connection token
  inboxEnabled   Boolean  @default(false)
  leadSyncEnabled Boolean @default(false)
  publishEnabled Boolean  @default(true)
  autoReply      String   @default("off") // off | suggest | auto
  subscribedAt   DateTime?
  status         String   @default("active") // active | revoked | error
  lastError      String?  @db.Text
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([platform, externalId])        // one tenant per Page, so webhooks route unambiguously
  @@index([businessId])
}
```
`SocialAccount` replaces reading pages from `OAuthConnection.metadata`. The callback (and a reconnect) upserts one row per Page and per linked Instagram account. Webhook routing looks up by `(platform, externalId)`. If a second tenant tries to claim the same Page, it gets a clear "already connected to another workspace" error.

### Design
- **Scopes** (add to `META_DEFAULT_SCOPES`): `pages_manage_posts`, `pages_manage_engagement`, `pages_read_user_content`, `read_insights`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`. `leads_retrieval`, `pages_messaging` and `instagram_manage_messages` are already requested.
- **Subscribe Pages:** on save, call `POST /{page-id}/subscribed_apps` with `subscribed_fields=leadgen,messages,messaging_postbacks,feed`. Instagram messaging and comments come through the Page subscription plus app-level `instagram` webhook fields. Run it as a `social.subscribe` job so failures retry. On disconnect, unsubscribe.
- **Callbacks** (both signed with `META_APP_SECRET`, using `signed_request`):
  - `POST /api/webhooks/meta/deauthorize`: mark the connection revoked.
  - `POST /api/webhooks/meta/data-deletion`: delete the Meta user's tokens and the social messages and identities tied to them. Return `{ url, confirmation_code }` and add a status page at `/data-deletion/[code]`.
- **Webhook routing:** split `metaWebhookJob` by object and field into `meta.leadgen` (G), `meta.message` (H) and `meta.comment` (H) jobs, keyed by `SocialAccount`. Events for unknown Pages are logged and dropped.
- **Settings UI:** Integrations → Connected accounts lists each Page and IG account with toggles for *Capture lead ads*, *Inbox*, *Publishing* and *AI replies (off / suggest / auto)*.

### Done when
- Connecting a test Page subscribes it, and a test `leadgen` event from Meta's Webhooks tester reaches the right tenant.
- The deauthorize and data-deletion callbacks pass Meta's callback validation.

---

## G. Meta Lead Ads sync

### Design
- **`meta.leadgen` job:**
  1. Fetch `GET /{leadgen_id}?fields=created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic` with the page token and `appsecret_proof`.
  2. Map `field_data` to name, email, phone and company. Standard keys are mapped automatically; custom questions use a per-form mapping and fall back to appending to `message`.
  3. Then `resolveContact` with an identity `{ type: "meta_lead", value: leadgen_id }`, `recordTouch({ kind: "ad_lead", channel: is_organic ? "social_organic" : "social_paid", source: platform (facebook | instagram), campaign: campaign_name, content: ad_name })`, and create the `Lead` with `source = social_paid | social_organic`.
  4. Finally `fireTrigger("new_lead")`, AI scoring and a notification.
- **Idempotency:** add `Lead.externalRef` (unique per business, e.g. `meta:<leadgen_id>`). Webhook retries and the poller never create duplicates.
- **Poll fallback:** webhooks get dropped. An hourly `meta.leadgen-poll` job reads `/{form_id}/leads?filtering=[{field:"time_created",operator:"GREATER_THAN",value:<last>}]` for each enabled form and enqueues anything missed. The same job backfills the last 90 days the first time a Page enables lead sync (Meta keeps leads for 90 days).
- **Forms UI:** Leads → *Lead forms* tab lists each Page's forms with lead counts, last lead time, an on/off switch and the field mapping.
- **Plan gating:** lead capture is a core lead feature, so `leads` module (Starter+). Ad lead volume counts against the existing `leads` quota.

### Done when
- Submitting Meta's Lead Ads Testing Tool form creates exactly one lead, with campaign/ad names on its first touch and `source = social_paid`. Replaying the webhook adds nothing.
- Killing the worker, submitting a lead, then restarting: the poller picks it up within the hour.

---

## H. Social inbox

### Problem today
Conversations only shows widget `ChatSession`s. WhatsApp inbound lives in a separate `WhatsAppMessage` table. The AI reply logic (KB retrieval, grounding prompt, handover) is written inline in `src/app/api/public/chat/route.ts`.

### Schema
Extend `ChatSession` instead of adding a parallel model, so the inbox, AI summaries, lead linking and retention keep working:
```prisma
// ChatSession additions
channel          String   @default("widget") // widget | messenger | instagram_dm | facebook_comment | instagram_comment
socialAccountId  String?
externalThreadId String?  // PSID / IGSID / comment thread root id
lastInboundAt    DateTime? // drives Meta's 24-hour reply window
autoReplyPaused  Boolean  @default(false) // human took over
@@unique([socialAccountId, externalThreadId])

// ChatMessage additions
externalId   String?  @unique // Meta mid / comment id, for dedupe
direction    String   @default("inbound") // inbound | outbound
deliveryStatus String? // sent | delivered | read | failed
sentByUserId String?
```

### Design
- **Extract the agent:** move reply generation into `src/lib/agent-reply.ts` as `generateAgentReply({ businessId, sessionId, channel })`: KB retrieval, grounding rules, brand context (`getBrandContext`), language detection, lead-intent and handover signals. The widget route and the social workers both call it. This is the riskiest refactor, so do it first with tests that compare widget responses before and after.
- **Inbound DMs (`meta.message`):**
  1. Upsert the session by `(socialAccountId, PSID/IGSID)`. Store the message, deduped on `mid`.
  2. `resolveContact` with an `fb_psid` / `ig_id` identity, plus the profile name (and IG username) fetched once.
  3. Then branch on the account's `autoReply` mode:
     - **auto:** generate and send a reply, unless a human replied in the last 30 minutes or `autoReplyPaused` is set.
     - **suggest:** store the draft as a suggestion (the existing `suggestions` route).
     - **off:** notify only.
- **Comments (`meta.comment`):** a new comment on a Page post or IG media opens or updates a comment thread. Agents can:
  - reply publicly: `POST /{comment-id}/comments` or `/replies`
  - send a private reply: `POST /me/messages` with `recipient.comment_id`, which moves the conversation into DMs
  - hide the comment
  - AI classification (`classify` task) flags buying intent, a question, a complaint or spam. Spam can auto-hide when enabled.
- **Outbound:** send through the Send API / IG Messaging API with the page token.
  - Enforce the 24-hour window from `lastInboundAt`. Within 7 days, allow human replies with the `HUMAN_AGENT` tag. After that, block with an explanation.
  - Auto-replies always say they come from an AI assistant.
- **Lead creation:** when the agent detects intent and the contact shares an email or phone (or an agent clicks *Create lead*), create a lead with `source = social_organic` and a `social_dm` touchpoint.
- **Conversations UI:**
  - a channel filter and channel badges
  - a reply composer for social threads that shows the time left in the 24-hour window
  - "AI suggested reply" chips, and a takeover toggle that pauses AI
  - comment threads show the post they're on
- **WhatsApp:** stays on its own screen in Phase 1. Moving it into this inbox is a natural Phase 1.5, since the schema supports `channel = whatsapp`.

### Done when
- A DM to the test Page shows up in Conversations within seconds. In *auto* mode the KB-grounded reply arrives in Messenger, and a human reply pauses the AI.
- A comment with "how much?" is flagged as intent, and a private reply opens a DM thread.
- Webhook replays never duplicate messages.

---

## I. Media library

### Why
The app has no file storage. Instagram publishing requires a public image URL, and Facebook and LinkedIn need images uploaded from somewhere.

### Design
- **`MediaAsset` model:** businessId, kind (image | video), storage key, public URL, mime type, size, width/height, alt text, source (upload | ai_generated | stock), createdBy.
- **`src/lib/storage.ts` driver interface:** `put`, `getPublicUrl`, `delete`.
  - **S3-compatible driver** (S3, Cloudflare R2, DigitalOcean Spaces, MinIO) for production.
  - **Local disk driver** for dev, serving from `/api/media/[key]`.
  - Env: `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`.
- **Uploads:** checked by magic bytes, not the extension. Limits of 8 MB per image and 100 MB per video. Images are re-encoded with `sharp`, which strips EXIF/GPS data and caps the longest side at 2048 px. A per-plan storage quota uses the existing quota system.
- **UI:** a media picker dialog (upload, library grid, alt text) reused by the Studio and the calendar.

### Done when
- An uploaded JPEG gets a public URL that Meta's servers can fetch, with its EXIF stripped.

---

## J. AI Content Studio

### Schema
```prisma
model ContentPost {            // one idea / brief, fanned out to channels
  id          String   @id @default(cuid())
  businessId  String
  brief       String   @db.Text
  goal        String?  // awareness | engagement | leads | promotion
  campaignTag String?  // free text now; becomes a Campaign relation in Phase 4
  status      String   @default("draft") // draft | in_review | approved | archived
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  variants    PostVariant[]
}

model PostVariant {            // the copy for one platform
  id            String  @id @default(cuid())
  postId        String
  platform      String  // facebook | instagram | linkedin | x | tiktok
  body          String  @db.Text
  hashtags      Json?   // string[]
  mediaIds      Json?   // MediaAsset ids, in order
  linkUrl       String? @db.Text
  imagePrompt   String? @db.Text // suggested visual, for designers or image AI
  aiGenerated   Boolean @default(true)
  editedByHuman Boolean @default(false)
}
```

### Design
- **Generate:** `aiStructured({ task: "content" })` takes the brief, goal, chosen platforms, `getBrandContext()` and the tenant's top-performing past posts once M exists. It returns one variant per platform.
- **Per-platform rules:** each platform has its own length limit, hashtag norms, line breaks and link handling. Instagram has no clickable links, so it uses "link in bio" wording.
- **Server-side checks:** the server validates against each platform's limits and re-asks once if a variant is over.
- **Studio UI** (new `social` module view, behind the `social_hub` flag):
  1. A brief box, platform checkboxes, a goal and a tone tweak ("more playful").
  2. *Generate*, which produces side-by-side variant cards with live character counts and a phone-style preview.
  3. Edit any variant, *Regenerate this one* or *Rewrite: shorter / add CTA / translate to fr*. Attach media from the library.
  4. *Send for approval* or *Schedule*.
- **Repurpose:** "Turn this KB article / blog post / lead question into posts" pre-fills the brief from a selected source.
- **Credits:** each generation is logged as `feature: "content_generate"` and counted against the monthly AI quota. Show remaining credits in the Studio.
- **Guardrails:**
  - The system prompt forbids inventing prices, offers, statistics or testimonials not in the brand profile or KB.
  - A `dontPhrases` check runs on the output.
  - Generated posts are never published without a human approving them (see K).

### Done when
- One brief gives Facebook, Instagram and LinkedIn variants that pass every platform limit. Banned phrases from the brand voice never appear (unit test with a stubbed provider).

---

## K. Calendar, approval and publishing

### Schema
```prisma
model ScheduledPost {          // one variant going to one account at one time
  id              String   @id @default(cuid())
  businessId      String
  variantId       String
  socialAccountId String?  // null for manual platforms (X, TikTok)
  scheduledFor    DateTime
  status          String   @default("scheduled") // pending_approval | scheduled | publishing | published | failed | cancelled | manual_due
  approvedById    String?
  approvedAt      DateTime?
  jobId           String?  // queue job that publishes it
  externalPostId  String?
  permalink       String?  @db.Text
  publishedAt     DateTime?
  attempts        Int      @default(0)
  lastError       String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([businessId, scheduledFor])
  @@index([status, scheduledFor])
}
```

### Design
- **Approval policy:** a business setting `contentApproval`:
  - `none`
  - `admins_approve`: members draft, admins approve
  - `always`: even admins confirm a second time
  - Posts that need approval sit in `pending_approval` and notify approvers. Approving enqueues the publish job.
- **Scheduling:** `enqueue(publishPostJob, { scheduledPostId }, { runAt: scheduledFor, dedupeKey: "publish:<id>" })`.
  - Rescheduling (dragging in the calendar) cancels and re-enqueues the job.
  - The handler re-checks status and `scheduledFor` before publishing, so a stale job is a no-op.
- **Publishers** (`src/lib/social/publish/{facebook,instagram,linkedin}.ts`):
  - **Facebook:** `POST /{page-id}/feed`, or `/photos` (multi-photo uses unpublished photos plus `attached_media`).
  - **Instagram:** create a container (`/{ig-id}/media` with `image_url` or carousel children), poll `status_code` until `FINISHED`, then `/{ig-id}/media_publish`. The 25-posts-per-24h limit is checked with `content_publishing_limit` before scheduling.
  - **LinkedIn:** `POST /rest/posts` as the organization, with images uploaded through the Images API (L).
- **Failures:**
  - Token/permission errors mark the account `error` and notify, with no retry.
  - Rate limits and 5xx errors retry through the queue's backoff.
  - The post shows *Failed: reconnect Instagram* with a one-click retry.
- **Manual platforms (X, TikTok):** these posts go into the calendar as `manual_due`. At the scheduled time the tenant gets a notification with *Copy text*, *Download image* and *Mark as posted*. Paid X API access and TikTok's content-posting audit aren't worth it for Phase 1 (see decisions).
- **Calendar UI:**
  - month and week views (date-fns plus the existing `@dnd-kit`)
  - drag to reschedule
  - colour by platform, and status icons for pending approval, scheduled, published and failed
  - click to open in the Studio
  - a "best time to post" hint once M has data, and a queue/list view on mobile
- **Time zones:** add `Business.timezone` (IANA). Times are stored in UTC and shown in the business time zone.

### Done when
- A post scheduled 2 minutes ahead publishes to the test Page and the IG test account, then shows the permalink.
- Dragging it to tomorrow before it fires moves the job, and nothing publishes early.
- A revoked token produces a clear failure and a notification, not silent retries.

---

## L. LinkedIn

### Design
- **OAuth provider** `src/lib/connections/providers/linkedin.ts`, alongside Meta and Google.
  - Scopes: `openid profile email` + `w_organization_social r_organization_social rw_organization_admin`, plus `r_marketing_leadgen_automation` once Lead Sync is approved.
  - LinkedIn access tokens last 60 days and refresh tokens 365 days, which the existing refresh job handles.
- **Organizations:** list the Pages the member administers (`/rest/organizationAcls?q=roleAssignee`) into `SocialAccount` rows (`linkedin_page`).
- **Publishing:** used by K.
- **Lead Gen Forms:**
  - A `linkedin.leadgen-poll` job every 15 minutes reads `/rest/leadFormResponses` per organization or ad account. It creates leads exactly like G (`externalRef = linkedin:<id>`, touchpoint `ad_lead`, `source = social_paid`, `clickIdType = li_fat_id` when present).
  - Lead notification webhooks can replace polling later.
- **Versioning:** every request sends the `LinkedIn-Version: YYYYMM` header. Keep it current, because LinkedIn retires versions after a year.

### Done when
- Connecting LinkedIn lists the test organization, a scheduled post publishes to it, and (after approval) a test form submission becomes a lead.

---

## M. Engagement analytics

### Schema
```prisma
model PostMetric {             // snapshot per published post
  id              String   @id @default(cuid())
  scheduledPostId String
  capturedAt      DateTime @default(now())
  impressions     Int?
  reach           Int?
  engagements     Int?     // reactions + comments + shares + saves
  clicks          Int?
  comments        Int?
  shares          Int?
  saves           Int?
  videoViews      Int?
  raw             Json?
  @@index([scheduledPostId, capturedAt])
}

model AccountMetric {          // daily follower / reach per account
  socialAccountId String
  date            DateTime @db.Date
  followers       Int?
  reach           Int?
  impressions     Int?
  @@id([socialAccountId, date])
}
```

### Design
- **Sync jobs:**
  - `social.metrics-post` runs at 1 hour, 24 hours, 72 hours and 7 days after publishing, then weekly for 4 weeks.
  - `social.metrics-account` runs daily.
  - Sources:
    - **Facebook:** `/{post-id}/insights`
    - **Instagram:** `/{media-id}/insights`
    - **LinkedIn:** `organizationalEntityShareStatistics`
- **Attribution tie-in:** published links get UTMs automatically (`utm_source=<platform>&utm_medium=social&utm_campaign=<campaignTag|post id>`). Workstream D then attributes resulting leads to the post. The dashboard shows **leads per post**, not just likes.
- **Dashboard** (social module):
  - totals and trends per platform
  - top posts by engagement rate and by leads
  - best weekday/hour heatmap
  - follower growth
- **Weekly AI insight:** a Monday job (`plan` task) reads the last 4 weeks of metrics, top and bottom posts and leads by post. With the brand context, it writes:
  - what worked
  - what didn't
  - 3 concrete post ideas for next week, each with a one-click *Open in Studio*
  - It's stored as an insight, shown on the dashboard and sent as a notification. It can also go by email if the email module is configured.

### Done when
- A published test post shows metrics within an hour of publishing, and a lead arriving through its UTM link counts toward that post.

---

## Cross-cutting

- **Packaging:**
  - **`social` module** (Starter+, flag `social_hub`): Studio, calendar, publishing and the analytics dashboard.
  - **Inbox and lead ads** extend existing modules: `conversations` and `leads`, so lead capture is never paywalled behind the social module.
  - **Suggested plan limits:**

    | Plan | Connected accounts | Scheduled posts/month | AI content generations/month |
    |---|---|---|---|
    | Starter | 3 | 30 | 50 |
    | Pro | 10 | unlimited | 300 |

- **Compliance:**
  - Meta Platform Terms: show the AI disclosure in auto-replies, respect the 24-hour messaging window, honour data-deletion requests.
  - Record publish approvals in the activity log.
  - The GDPR export and delete cover the new models.
  - Retention covers social messages through the existing chat retention window.
- **Security:**
  - Page tokens stay encrypted in `SocialAccount.accessToken`.
  - Every webhook is verified with `x-hub-signature-256` (already in place). Callbacks verify `signed_request`.
  - Uploaded media is re-encoded before it is ever served.
  - Publishing actions require the admin role, or approval under the policy.
- **Testing:**
  - unit tests for field mapping, the window rules, platform limit checks, publisher request building (stubbed fetch) and the agent-reply refactor
  - DB integration tests for webhook idempotency and scheduling and rescheduling
  - recorded fixture payloads from Meta's webhook tester checked into `tests/fixtures/meta`
- **Docs:** `DEPLOYMENT.md` sections for the Meta app setup (permissions, webhooks, callbacks), LinkedIn app setup and storage configuration, plus the new `.env.example` variables.

## Open decisions (owner: product)

1. **AI images:** Claude doesn't generate images. Options are:
   - (a) uploads and a stock library only (Unsplash/Pexels API, free with attribution)
   - (b) add an image model (OpenAI `gpt-image`, Google Imagen or Stability) as a paid add-on
   - (c) (a) now and (b) later

   **Recommendation:** (c). The Studio already writes an `imagePrompt` for each post.
2. **Storage:** S3-compatible object storage (R2 is cheapest, with no egress fees) or local disk on the app server? Local disk doesn't work with multiple app instances or serverless, and Instagram needs the files publicly reachable.
3. **X and TikTok:** manual-publish only in Phase 1 (recommended), or budget for X API Basic (paid monthly) and the TikTok content-posting audit?
4. **Auto-reply default:** new Pages start in *suggest* (recommended) or *auto*?
5. **Approval default:** `admins_approve` for teams with more than one user and `none` for solo tenants (recommended), or always on?
6. **Unified inbox:** move WhatsApp into the social inbox in Phase 1 (+3–4 days) or leave it for Phase 1.5?
7. **Plan limits:** confirm the suggested numbers above, or define them in `SubscriptionPlan`.
