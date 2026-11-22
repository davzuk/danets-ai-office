# Phase 2: Website Capture

**Date:** 2026-11-22
**Goal:** Turn more of a tenant's website visitors into leads and booked calls. The widget starts conversations by itself, qualifies visitors before the chat and books meetings. Tenants without a good website get AI-built landing pages on their own domain. Forms and lead magnets capture people who don't want to chat.
**Builds on:**
- Phase 0: AI provider layer (A), job queue (B), OAuth connections (C), contacts and attribution (D), Brand Voice (E).
- Phase 1: media library (I) for page images and lead-magnet files, UTM tagging (M).

| # | Workstream | Delivers | Est. (1 dev) |
|---|---|---|---|
| N | Widget on any website | Absolute API base, CORS and allowed origins on `/api/public/*`, page context sent with each chat | 2–3 days |
| O | Proactive messages and pre-chat form | URL, time-on-page, scroll and exit-intent triggers; a configurable pre-chat form; per-rule stats | 4–5 days |
| P | Booking | Native availability and slots, Google Calendar sync, Calendly link/embed, a booking step in the widget and on pages | 6–8 days (+ Google verification) |
| Q | Tenant sites and landing pages | Tenant-scoped sites on a Danets subdomain or a custom domain, block-based pages, publish and versioning | 7–9 days |
| R | AI landing page builder | One prompt → a full page of blocks in the brand voice, with a lead form; regenerate any section | 4–5 days |
| S | Form builder | Drag-and-drop forms, hosted, on pages and embeddable; spam protection; submissions → Lead + Contact | 5–6 days |
| T | Lead magnets | Gated PDFs from the media library or AI-written checklists and guides, delivered by email | 4–5 days |

**Order:** N first, because the widget can't work on a tenant's own domain today (see N), and O and P build on it. S comes before Q's lead-form block and before T, which is gated by a form. R needs Q. P can run in parallel with Q after N.
**Total:** about 7–8 weeks for one developer, or 4–5 weeks with two (one on N→O→P, one on S→Q→R→T).

**External lead time (start in week 1):**
- **Google OAuth verification** for the Calendar scopes (`calendar.events`, `calendar.freebusy`). These are sensitive scopes, so they need a privacy policy, a demo video and a few weeks for review. Phase 3 needs Search Console and Business Profile verification on the same app, so submit them together.
- **Wildcard DNS and TLS** for the sites domain (e.g. `*.danets.site`), and a way to issue certificates for tenants' custom domains (see open decision 1).
- **Email deliverability** for lead-magnet delivery and booking confirmations: SPF, DKIM and DMARC on the sending domain, and a transactional provider if SMTP volume grows.

---

## N. Widget on any website

### Problem today
- The embed snippet loads `${origin}/widget.js`, but the script sets `API = ""`. Every call (`/api/public/widget`, `/chat`, `/lead`, `/track`) then goes to the *host page's* origin. On a tenant's own website these calls hit the tenant's server and fail. It only works on Danets' own pages.
- `/api/public/*` sends no CORS headers, so even with an absolute URL the browser would block the JSON responses.
- The chat doesn't know which page the visitor is on, so the AI can't use it and proactive rules (O) can't target pages.

### Design
- **API base:** `widget.js` takes the API base from its own `src` (`new URL(document.currentScript.src).origin`), falling back to `NEXT_PUBLIC_APP_URL` baked in at serve time.
- **CORS:** one helper, `publicCors(req, business)`, for every `/api/public/*` route. It answers `OPTIONS` preflight, echoes the `Origin` only when it's allowed and never sends credentials (the widget uses no cookies).
- **Allowed origins:** new `Business.widgetAllowedOrigins` (JSON list of host patterns, empty = any). It's on `Business` because the public key is, and every public route already loads it. Set in Widget Embed with an "Only run the widget on my websites" switch; super admins can see and clear it on the tenant page. Requests from other origins get 403. This stops a copied `pk` from being used on someone else's site.
- **Page context:** each chat and track call sends `{ url, title }` (origin + path only, the same stripping as touchpoints). The AI prompt gets "The visitor is on: <title>".
- **CSP:** the widget is a script on the tenant's page, so their CSP needs our origin in `script-src` and `connect-src`. Widget Embed shows the exact lines to add.

### Done when
- The widget loads, chats and captures a lead from a plain HTML page on another origin (e.g. `http://127.0.0.1:8080`), with no console errors.
- With allowed origins set, the same page from an unlisted origin gets 403 and the widget hides itself.

---

## O. Proactive messages and pre-chat form

### Schema
```prisma
model WidgetRule {                // one proactive message
  id          String   @id @default(cuid())
  businessId  String
  name        String
  enabled     Boolean  @default(true)
  priority    Int      @default(0)
  // { urlMatch: { type: "contains"|"equals"|"prefix", value }[], trigger: "time"|"scroll"|"exit"|"load",
  //   seconds?, scrollPercent?, visitor: "any"|"new"|"returning", devices: ("desktop"|"mobile")[] }
  conditions  Json
  message     String   @db.Text
  quickReplies Json?            // optional buttons under the message
  action      String   @default("open") // open (bubble + open chat) | bubble (teaser only) | form | booking
  frequency   String   @default("session") // session | day | once
  shows       Int      @default(0)
  opens       Int      @default(0)
  leads       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([businessId, enabled])
}

// AiAgent additions
preChatForm  Json?   // { enabled, fields: [{ key: "name"|"email"|"phone"|"company"|custom, label, required }], consentText? }
```

### Design
- **Rules engine in `widget.js`:** `/api/public/widget` returns the enabled rules. The script picks the highest-priority rule matching the URL, visitor type and device. It arms one trigger:
  - a timer
  - a scroll listener
  - exit intent: the mouse leaves through the top on desktop; on mobile, a fast upward scroll or tab blur after 15 seconds
- **Frequency caps:** kept in `localStorage`. A visitor who closed a message doesn't see it again in that session.
- **Stats:** shows, opens and leads are counted through a small `/api/public/widget/event` beacon. They're rate-limited per visitor and stored as counters on the rule, not as rows. A lead counts for a rule when its chat started from that rule.
- **Pre-chat form:** shown before the first message when enabled. It fills `ChatSession.visitorName/Email/Phone` and resolves the Contact straight away. If the email is valid it creates the lead at once, with `source` from attribution, so a visitor who leaves after one message is still captured.
- **Consent:** the optional consent text is stored on the lead's activity log entry with the timestamp.
- **UI:** a new *Proactive messages* tab in AI Agent, with a list of rules, an editor with a live widget preview, and per-rule show → open → lead rates.
- **Gating:** proactive rules need Starter+ (`embed` module, flag-free). The pre-chat form is available on all plans.

### As built
- `WidgetRule` counts `shows`, `chats` and `leads`. Only "show" uses the beacon. A chat counts when a session starts with the rule's id (`ChatSession.widgetRuleId`). A lead counts when that session produces one.
- Actions: `bubble` (the default), `open`, or `booking` (added in P: the bubble opens the chat on the booking step). On phones, `open` falls back to the bubble. The `form` action waits for S.
- Pages use `{ match, value }`. The matcher is plain JS, shared by `widget.js` and the tests (`RULE_MATCHER_JS`). Mobile exit intent uses the fast upward scroll only, with no tab blur.
- The pre-chat form has fixed fields (name, which is always asked, plus email / phone / company, each off, optional or required). There are no custom fields until S. A browser that has completed the form is remembered, so it isn't asked again.
- Gating uses its own `proactive_messages` module (Starter+, flag-free), so Free plans keep the embed.

### Done when
- A "30 seconds on /pricing" rule opens on that page only, once per session, and its counters go up.
- Exit intent fires on desktop and doesn't fire on a page that doesn't match.
- A pre-chat form with email required creates a lead before the AI has replied.

---

## P. Booking

### Schema
```prisma
model BookingType {               // "30-min consultation"
  id            String   @id @default(cuid())
  businessId    String
  name          String
  slug          String
  durationMin   Int      @default(30)
  bufferMin     Int      @default(0)
  minNoticeHours Int     @default(4)
  maxDaysAhead  Int      @default(30)
  // { mon: [["09:00","17:00"]], ... } in Business.timezone
  availability  Json
  location      String   @default("phone") // phone | video | in_person | custom
  locationDetail String?
  questions     Json?    // extra fields asked when booking
  provider      String   @default("native") // native | google | calendly
  calendarId    String?  // Google calendar to check and write to
  calendlyUrl   String?  @db.Text
  assignedUserId String? // team member who takes the meeting
  active        Boolean  @default(true)
  @@unique([businessId, slug])
}

model Booking {
  id            String   @id @default(cuid())
  businessId    String
  bookingTypeId String?
  leadId        String?
  contactId     String?
  sessionId     String?          // chat it came from
  name          String
  email         String
  phone         String?
  startsAt      DateTime
  endsAt        DateTime
  status        String   @default("confirmed") // confirmed | cancelled | completed | no_show
  answers       Json?
  externalId    String?  @db.VarChar(191) // Google event id / Calendly invitee uri
  cancelToken   String   @unique          // for the visitor's cancel/reschedule link
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([businessId, externalId])
  @@index([businessId, startsAt])
}
```

### Design
- **Slots:** `availableSlots(bookingType, from, to)` takes the weekly hours in `Business.timezone`, removes existing `Booking`s and Google free/busy blocks (when connected), and applies notice, buffer and horizon. Pure and unit-tested across DST changes.
- **Booking:** `POST /api/public/bookings` re-checks the slot inside a transaction, so two visitors can't take the same slot. It then:
  1. creates the Booking
  2. resolves the Contact
  3. records a `booking` touchpoint
  4. creates or updates the Lead, moving it to `qualified`
  5. fires the new `booking_created` automation trigger
  6. sends both sides an email with an `.ics` invite
- **Google Calendar:** adds the Calendar scopes to the existing Google provider through incremental consent, so only tenants who turn it on are asked. Bookings are written as events with a Meet link when `location = video`. Removing an event in Google cancels the booking (a `booking.sync` job every 15 minutes, plus push notifications when available).
- **Calendly:** a tenant who already lives in Calendly pastes their event link. The widget and pages open Calendly's embed with `utm_*` and the visitor's name and email prefilled.
  - A Calendly connection (personal access token, encrypted like other keys) lets an `invitee.created` webhook create the Booking and Lead.
  - Calendly webhooks need a paid Calendly plan. Without one, the link still works but bookings aren't recorded in Danets.
- **Widget step:** when the AI detects booking intent (added to the existing intent detection), or a rule's action is `booking`, the widget shows the next available slots inline. Picking one asks only for the fields it doesn't already have.
- **Hosted page:** `/<site>/book/<slug>` (Q), plus a `booking` block for landing pages.
- **Reminders:** 24-hour and 1-hour reminder emails go through the job queue, and the reminder template has a cancel and reschedule link. WhatsApp reminders reuse the WhatsApp module's templates when it's enabled.
- **Dashboard:** a new Bookings tab in Leads, with an upcoming list, a calendar view (reusing the content calendar's month grid), status changes and no-show marking.
- **Gating:** `leads` module (Starter+). Google and Calendly sync need Pro.

### As built (part 1: native booking)
- Schema as above, plus `description`, `slotStepMin`, `bufferMin`, `notes`, `visitorTimezone`, `source` (page | widget), `consentText`, cancellation fields and a `sequence` for `.ics` updates. A `bookingTypeLimit` plan limit (3 / 10 / unlimited) and a `booking` touchpoint kind.
- Slots: `computeSlots` in `src/lib/booking/slots.ts` (pure, DST-tested). Existing bookings block their own buffer as well as the new type's. Google free/busy came in part 2.
- Booking: `src/lib/booking/service.ts`. The transaction locks the business row (`SELECT … FOR UPDATE`) and re-checks the slot, so the second of two simultaneous bookings gets 409 `SLOT_TAKEN`. A booking doesn't trigger AI lead scoring.
- Hosted pages live on the app domain for now (`/book/<publicKey>/<slug>`, `noindex`) and move under tenant sites in Q. Visitors manage a booking at `/book/manage/<token>`.
- Widget: booking intent comes from the chat reply (`booking` in the `/api/public/chat` response) or a rule with the `booking` action. It shows 3 days × 6 times inline plus a link to the full page.
- Dashboard: Leads → Bookings (upcoming, calendar, past, booking types, business time zone). Members can cancel, or mark completed or no-show once the start has passed.
- Notifications `booking_created` / `booking_cancelled` and the automation triggers of the same names.

### As built (part 2: calendar sync, Calendly, automation and WhatsApp)
- Schema: `BookingType.calendarConnectionId`, `calendarId`, `calendarSyncedAt`, `calendlyEventTypeUri`; `Booking.externalProvider` (google | calendly), `externalData` and `meetingUrl`. Migration `20261205100000_booking_sync`.
- Plan gating: a new internal module `booking_sync` (Pro). It covers Google Calendar on a booking type and recording Calendly bookings. A Calendly link on a booking type works on every plan.
- Google Calendar: "Connect Google Calendar" asks for `calendarlist.readonly`, `calendar.freebusy` and `calendar.events` on top of the existing Google scopes (`include_granted_scopes`). Free/busy runs before the booking lock and fails open (a Google outage shows the weekly hours). Each booking adds an event (`sendUpdates=none`, since Danets sends the invites) with a Meet link for video bookings without a fixed link. Moves patch the event and cancellations delete it. The booking's own event doesn't block nearby times while rescheduling.
- `booking.sync` runs every 15 minutes (`updatedMin` with `showDeleted`, at most 20 days back) and cancels upcoming bookings whose event was deleted in Google. Moving an event in Google doesn't move the booking. Push notifications (`events.watch`) were left out: they need a public HTTPS domain verified with Google, and the 15-minute poll covers the same case.
- Calendly: a booking type can point at a Calendly link. The hosted page and the widget show Calendly's inline embed (or a "Choose a time" link) with prefill and UTM tags. Connecting a personal access token subscribes a user-scope webhook (`/api/webhooks/calendly/<integrationId>`, HMAC-signed with a per-connection key) for `invitee.created` and `invitee.canceled`. These create or cancel a Danets booking, lead, contact and touchpoint. Calendly sends its own emails and reminders, so Danets sends none for these bookings and can't cancel them; cancel in Calendly instead. Webhooks need a paid Calendly plan.
- Automation action `send_booking_link`: emails the lead a prefilled link to a booking type (or the first active one), with an optional custom message. It is the only automation action that messages people outside the team. Leads without an email address are skipped.
- WhatsApp reminders: a template of type `booking_reminder` (`{name} {service} {company} {time} {link}`) is sent with each reminder email. This needs the WhatsApp module, an active Meta or Twilio integration, and a phone number on the booking. Meta's free-form text only reaches people who messaged the business in the last 24 hours, so some reminders won't arrive. Approved Meta template messages are not supported yet.

### Done when
- Two simultaneous bookings for one slot: exactly one succeeds.
- A booking made from the widget creates the Lead, Contact, touchpoint, Google event and both emails. Cancelling through the email link frees the slot and deletes the event.
- Slots stay right across a DST change in a non-UTC timezone.

---

## Q. Tenant sites and landing pages

### Problem today
The CMS (`CmsSite`, `CmsPage`, `CmsBlock`) is Danets' own marketing site: a single row, globally unique slugs and no `businessId`. Tenants have no pages of their own, and `WhiteLabelConfig.customDomain` is stored but never routed.

### Schema
Separate tenant models; the platform CMS stays as it is. Both share the block renderer and block schemas.
```prisma
model TenantSite {
  id             String   @id @default(cuid())
  businessId     String   @unique         // one site per tenant to start
  subdomain      String   @unique         // <subdomain>.SITES_DOMAIN
  customDomain   String?  @unique
  domainStatus   String   @default("none") // none | pending | verified | failed
  domainToken    String?                   // TXT record value for verification
  theme          Json?    // { primaryColor, accentColor, font, logoMediaId, faviconMediaId }
  seoDefaults    Json?
  widgetEnabled  Boolean  @default(true)   // add the chat widget to every page
  analyticsTag   String?  // optional GA4 / Meta Pixel ids (no free-form script)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model LandingPage {
  id           String    @id @default(cuid())
  businessId   String
  siteId       String
  slug         String                     // "" = home page
  title        String
  blocks       Json      @default("[]")   // draft: [{ blockKey, props }]
  publishedBlocks Json?                   // what visitors see
  seo          Json?     // { title, description, ogImageMediaId, noindex }
  status       String    @default("draft") // draft | published | archived
  publishedAt  DateTime?
  views        Int       @default(0)
  conversions  Int       @default(0)
  generatedFrom String?  @db.Text          // the AI prompt, if R built it
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@unique([siteId, slug])
  @@index([businessId, status])
}

model LandingPageVersion {         // a snapshot on every publish, for rollback
  id        String   @id @default(cuid())
  pageId    String
  blocks    Json
  publishedBy String?
  createdAt DateTime @default(now())
  @@index([pageId, createdAt])
}
```

### Design
- **Routing:** `middleware.ts` checks the `Host`. The app host is handled as now. `<sub>.SITES_DOMAIN` or a verified custom domain is rewritten to `/_sites/[host]/[[...slug]]`, which loads the site and the published page. Everything else under that host returns 404, so tenant hosts never serve `/app`, `/platform` or `/api` (except `/api/public/*`).
- **Isolation:** tenant pages are served on a different registrable domain from the app. The `danets_session` cookie and the app's CSP never apply to tenant content, and a tenant page can't read app cookies.
- **Blocks:** no raw HTML or script blocks. The existing blocks (hero, feature-grid, testimonials, faq, cta, stats, rich-text, logo-cloud) are reused through `BlockRenderer`. New blocks:
  - `lead-form` (S)
  - `booking` (P)
  - `lead-magnet` (T)
  - `contact-details` (address, map link, hours, WhatsApp)
  - `gallery`
  - `video` (YouTube and Vimeo by URL only)

  Images come from the media library.
- **Editor:** a new *Website* view with:
  - a page list
  - a block editor: add, reorder (dnd-kit), edit through forms generated from the block schemas, and a live preview at desktop and phone widths
  - publish, unpublish and version history with a restore button
- **SEO basics:**
  - per-site `sitemap.xml` and `robots.txt`
  - canonical URLs
  - OpenGraph tags
  - `LocalBusiness` JSON-LD from the business profile

  Phase 3 builds on this.
- **Custom domains:** the tenant adds a CNAME to `sites.<SITES_DOMAIN>` and a TXT `_danets.<domain>` with `domainToken`. A `site.verify-domain` job checks DNS every 10 minutes for 72 hours. Certificates come through Caddy's on-demand TLS, with an `ask` endpoint (`/api/public/domains/check`) that only approves verified domains (see open decision 1).
- **Stats and attribution:**
  - The page counts views server-side, one per visitor per day, as `visit` touchpoints with `landingUrl`. Conversions are leads with a first touch on the page.
  - With `widgetEnabled`, the widget is injected with the tenant's `pk`, so chats and forms carry the page's attribution.
- **Gating:** new module `sites` (Starter+, flag `sites_builder`).
- **Suggested plan limits:**

  | Plan | Published pages | Custom domain |
  |---|---|---|
  | Starter | 3 | no |
  | Pro | 25 | yes |
  | Enterprise | unlimited | yes |

  The platform console gets the same overrides as other limits.

### Done when
- A page published at `acme.danets.site/roofing` renders with the tenant's theme and widget. The same path on the app host is a 404, and `/app` on the tenant host is a 404.
- A test custom domain (pointed through `/etc/hosts` locally) goes pending → verified, and the `ask` endpoint refuses an unverified one.
- Restoring an older version puts it live, and the change is in the activity log.

---

## R. AI landing page builder

### Design
- **Input:** a prompt ("landing page for my roofing service in Lagos"), plus optional goal (leads | bookings | downloads), audience, offer and which form, booking type or lead magnet to use.
- **Generation:** `aiStructured({ task: "plan" })` with a Zod schema built from the block schemas. The model can only return blocks that exist, with valid props.
  - **Context:** `buildBrandContext()`, the top KB items for the prompt (existing retrieval), the business profile and the media library's image descriptions.
  - **Output:** the title, SEO title and description, a slug, and 5–9 blocks that always include one conversion block matching the goal.
  - **Images:** chosen from the media library where a description matches; otherwise the block keeps an `imagePrompt` and a placeholder, as the Content Studio does.
- **Facts guard:** the system prompt tells the model to use only facts from the business profile and KB. Prices, years in business, certifications and testimonials it can't support are left as visible placeholders (`[Add a real testimonial]`) and listed in a checklist the tenant clears before publishing. Publishing is blocked while any placeholder remains.
- **Section edits:** *Regenerate*, *Shorter*, *More persuasive* or a free-text instruction on any one block, sending only that block and the page outline.
- **Cost:** a page generation costs 1 AI credit and a section edit costs 0.25, both through `checkMonthlyAiQuota` and `logUsage` with feature `landing_page`. The result is always a draft.

### Done when
- Five prompts across different industries each produce a page that passes the block schemas with no fix-ups, includes the requested conversion block and invents no facts (checked against a fixture KB).
- A section edit changes only that block.

---

## S. Form builder

### Schema
```prisma
model LeadFormDef {               // "Form" is too generic next to Meta's lead forms
  id          String   @id @default(cuid())
  businessId  String
  name        String
  // [{ key, type: text|email|phone|textarea|select|radio|checkbox|date|hidden, label, required, options?, mapTo?: "name"|"email"|"phone"|"company"|"service"|"message" }]
  fields      Json
  settings    Json     // { submitLabel, successMessage, redirectUrl, notifyUserIds, consentText, leadQuality, assignTo, tags }
  status      String   @default("active") // active | archived
  submissions Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([businessId, status])
}

model FormSubmission {
  id         String   @id @default(cuid())
  businessId String
  formId     String
  leadId     String?
  contactId  String?
  data       Json     // every answer, including unmapped fields
  pageUrl    String?  @db.Text
  ipHash     String?  @db.VarChar(64)
  spamScore  Int      @default(0)
  status     String   @default("accepted") // accepted | spam
  createdAt  DateTime @default(now())
  @@index([formId, createdAt])
  @@index([businessId, createdAt])
}
```

### Design
- **Builder:** a new *Forms* tab in Leads, with a dnd-kit field list, per-field settings, mapping to Lead fields and a live preview. Templates: contact, quote request, callback, newsletter.
- **Where forms run:**
  1. the `lead-form` block on landing pages
  2. a hosted page at `/<site>/f/<formId>`
  3. an embed on any website, `<div data-danets-form="<id>"></div>` with `widget.js`, which renders the form with no chat UI when `data-chat="off"`
- **Submit:** `POST /api/public/forms/<id>` validates the answers against the stored fields with Zod, built per form. It then:
  1. resolves the Contact
  2. records a `form_submit` touchpoint
  3. creates or updates the Lead (dedupe on email per business, as today)
  4. stores the `FormSubmission`
  5. fires the new `form_submitted` trigger, with the form id available to automation conditions
  6. notifies the users in `notifyUserIds`
- **Spam:**
  - Always on: a honeypot field, a minimum fill time, and the existing per-IP rate limit plus a per-form limit.
  - Optional: Cloudflare Turnstile when `TURNSTILE_SECRET` is set.

  Suspected spam is stored with `status = spam`, creates no lead and can be released from the UI.
- **Retention and GDPR:** submissions follow `leadRetentionDays` and are included in the export and delete. IPs are stored only as a salted hash.

### Done when
- A form with custom fields creates one Lead with the mapped fields, keeps the unmapped answers on the submission and fires `form_submitted`.
- The same form works embedded on another origin (N) and on a landing page.
- A bot-fast submission and a honeypot hit are both marked spam with no lead.

---

## T. Lead magnets

### Schema
```prisma
model LeadMagnet {
  id          String   @id @default(cuid())
  businessId  String
  title       String
  description String?  @db.Text
  kind        String              // upload | ai_checklist | ai_guide
  mediaId     String?             // the PDF in the media library
  content     Json?               // AI-written sections, re-rendered to PDF on edit
  coverMediaId String?
  formId      String              // the gate
  deliveryEmail Json?             // { subject, intro } override
  downloads   Int      @default(0)
  status      String   @default("draft") // draft | published
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([businessId, status])
}
```

### Design
- **Upload:** pick a PDF from the media library. Uploads are already re-encoded and size-capped there, and PDF is added to the allowed types for this use only.
- **AI-written:** a prompt ("10-point checklist before replacing your roof") goes through `aiStructured` with the brand context and KB. The result is sections of headings, items and short paragraphs. The tenant edits them in a structured editor, and the PDF is rendered with `@react-pdf/renderer` (already used for invoices and proposals) using the site theme, then saved to the media library. Costs 1 AI credit, feature `lead_magnet`.
- **Gate:** a lead magnet always uses a form (S). On submit, the visitor sees a thank-you and gets an email with a signed download link: an HMAC of the magnet id, submission id and expiry, valid for 7 days. `GET /api/public/magnets/download` checks it, counts the download and redirects to the file.
- **Attribution:** the lead's activity shows which magnet they downloaded, and `form_submitted` carries `leadMagnetId` so automations can start a follow-up.
- **Where:** the `lead-magnet` block (cover, bullet points, form), the hosted page `/<site>/m/<id>`, and as a widget rule action (O).
- **Gating:** `sites` module.

### Done when
- An AI checklist goes from prompt to edited PDF to a published block. Submitting the gate sends an email whose link downloads the PDF once the link is valid, and is refused after expiry or tampering.

---

## Cross-cutting

- **Packaging:**
  - New module `sites` (Starter+, flag `sites_builder`): Website, landing pages, AI builder, lead magnets.
  - Proactive messages, the pre-chat form and forms extend `embed` and `leads`, so basic capture is never behind the new module.
  - Booking is in `leads`, with calendar sync on Pro.
  - The platform console gets every new flag, limit and override, and a super-admin view of tenant sites and domains (suspend a site, clear a domain).
- **Plan limits:** add `pageLimit`, `formLimit`, `leadMagnetLimit`, `bookingTypeLimit` and `customDomainLimit` to `SubscriptionPlan` and `BusinessLimitOverride`, with defaults set in seed.
- **Automations:**
  - new triggers: `form_submitted`, `booking_created`, `booking_cancelled`, `lead_magnet_downloaded`
  - new action: `send_booking_link`
- **Security:**
  - `/api/public/*` CORS as in N, with no credentials.
  - Tenant pages are on another domain with their own strict CSP: no inline scripts and nonces only.
  - Blocks are structured, with no raw HTML. Video embeds are allowlisted.
  - Signed, expiring download and cancel links.
  - The domain `ask` endpoint only approves verified domains, which stops anyone from making us issue certificates for arbitrary hosts.
- **Compliance:**
  - Consent text and timestamp are stored with each pre-chat, form and booking submission.
  - The widget's `data-consent="required"` mode also holds back proactive triggers until consent.
  - Lead-magnet and booking emails are transactional (requested by the visitor), so they need no marketing opt-in. Adding the person to a newsletter needs its own checkbox.
- **Testing:**
  - unit tests for the rule matcher, slot calculation (DST, buffers, notice), form schema building, AI page schema validation, placeholder detection and download-link signing
  - DB integration tests for the double-booking race, form → lead dedupe and domain verification state
  - a cross-origin e2e page served from a second local port for N, O and S
- **Docs:** `DEPLOYMENT.md` sections for the sites domain and wildcard DNS, custom-domain TLS (Caddy on-demand config), Google Calendar scopes, Calendly webhook setup, Turnstile and the new `.env.example` variables (`SITES_DOMAIN`, `TURNSTILE_SITE_KEY/SECRET`, `MAGNET_LINK_SECRET`).

## Open decisions (owner: product)

1. **Custom-domain TLS:**
   - (a) Caddy on-demand TLS on our server: free, but one server terminates all tenant domains.
   - (b) Cloudflare for SaaS (custom hostnames): paid per hostname above the free allowance, with edge caching and DDoS protection included.

   **Recommendation:** (a) now behind the `ask` endpoint, and (b) when tenant domains pass a few hundred.
2. **Sites domain:** which domain hosts tenant subdomains (e.g. `danets.site`)? It must be a separate registrable domain from the app for cookie isolation, not a subdomain of the app's domain.
3. **Booking default:** native slots with Google sync (recommended: no extra account for the tenant, and bookings are always recorded), or Calendly-first for tenants who already use it? Both are planned; this only decides which one the setup wizard shows first.
4. **Spam protection:** turn on Cloudflare Turnstile for every tenant by default (free, needs one site key for the platform), or keep it optional?
5. **One site per tenant** to start (recommended), or several (e.g. per brand or location) now? The schema allows several later by dropping the unique on `businessId`.
6. **Plan limits:** confirm the suggested page and custom-domain numbers above.
7. **Free plan:** should Free tenants get one published landing page on the Danets subdomain, with "Built with Danets" branding, as a growth loop?
