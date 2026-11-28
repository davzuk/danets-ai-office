# Phase 4: Campaigns

**Date:** 2026-11-28
**Status:** Plan approved with the recommended answers to the open decisions (2026-11-28). AA built.
**Goal:** Give tenants one place to plan a marketing push, run it across channels and see what it earned. A campaign ties together the posts, forms, lead magnets, pages, emails and ads that belong to it, and reports leads, bookings, won deals, revenue, spend and cost per lead against its budget.
**Builds on:**
- **Phase 0:** contacts and attribution (D: `Touchpoint.campaign`, click IDs, first and last touch on `Lead`), the job queue (B), OAuth connections (C), Brand Voice (E) and the AI provider layer (A).
- **Phase 1:** the Content Studio and calendar (J, K), whose `ContentPost.campaignTag` and `utm_campaign` tagging (`src/lib/social/utm.ts`) this phase replaces with a real record; Meta Lead Ads (`meta-leads.ts` already reads `campaign_name`); weekly AI insights (M).
- **Phase 2:** forms (S), lead magnets (T), booking (P) and platform-built landing pages (Q, R).
- **Phase 3:** the monthly white-label report (Z), which gains a campaigns section.

**Product rules carried over:**
- Tenants don't build websites (see `PLATFORM-SITES-REWORK-PLAN.md`). A campaign can *request* a landing page from the platform. It never creates or publishes one itself.
- Nothing goes out without approval when approval is on: posts, emails and AI-drafted plans all wait for a human.
- The platform holds the AI keys; campaign AI uses the tenant's chosen model (`Business.aiModel`).

| # | Workstream | Delivers | Est. (1 dev) |
|---|---|---|---|
| AA | Campaign records | The `Campaign` model, linking posts, forms, magnets, pages and booking types, `campaignTag` migration, touchpoint matching | 4–5 days |
| AB | Tracked links | Short links with UTM tags for any channel (print, QR, partner sites, email), click counting, safe redirects | 2–3 days |
| AC | Ad spend import | Meta Ads daily spend and results per campaign, mapping Meta campaigns to Danets campaigns, manual and CSV spend for other channels | 5–6 days (+ Meta Ads permission review) |
| AD | Email campaigns | Consent-based audiences, AI-drafted emails in the brand voice, batched sending, one-click unsubscribe, bounces and complaints, click tracking | 7–9 days |
| AE | Campaign results | Per-campaign dashboard: leads, bookings, won deals, revenue, spend, CPL, ROAS, by channel and over time, with a choice of attribution model | 4–5 days |
| AF | AI campaign planner | From a goal and budget, draft a plan: channels, a post schedule, an email, a form or magnet, and a page request, all as drafts | 3–4 days |

**Order:** AA first, since everything hangs off the record. Then AB and AE together (AE can report on posts, forms and links before spend exists). AC once Meta grants the Ads permission. AD can run in parallel with AC (it needs only AA and AB's click redirect). AF last, because it drafts into everything else.
**Total:** about 5–6 weeks for one developer, or 3–4 weeks with two (one on AA→AB→AE→AF, one on AD then AC).

**External lead time (start in week 1):**
- **Meta `ads_read`.** Reading a tenant's ad account needs the `ads_read` permission, which goes through Meta App Review (Business Verification is shared with Phase 1's review). Submit it with a screencast of the spend screen.
- **Bulk email requirements.** Gmail and Yahoo require SPF, DKIM and DMARC alignment, one-click unsubscribe (RFC 8058) and a spam rate under 0.3% for bulk senders. The platform's sending domain needs DKIM and a DMARC record before AD goes live, and the email provider's event webhook must be set up.
- **Google Ads** is not in this phase (see open decision 2). Its API needs a developer token with Basic access, which Google approves separately.

> **Verify before building:** check the Meta Marketing API insights fields (`spend`, `actions` with `lead` and `onsite_conversion.lead_grouped`, `time_increment=1`), the current Graph version, and the Lead Ads lead fields (`campaign_id`, `adset_id`, `ad_id`) against Meta's docs before AC starts.

---

## AA. Campaign records

### Problem today
- `ContentPost.campaignTag` is free text. Two spellings make two campaigns, and nothing else (forms, magnets, pages, ads) can be tagged at all.
- `Touchpoint.campaign` stores whatever `utm_campaign` or Meta `campaign_name` arrived with, so there is no reliable way to say "these leads came from the spring sale".

### Schema
```prisma
model Campaign {
  id          String    @id @default(cuid())
  businessId  String
  name        String    @db.VarChar(160)
  slug        String    @db.VarChar(80) // the utm_campaign value; frozen once anything is published with it
  goal        String    @default("leads") // leads | bookings | sales | awareness
  status      String    @default("draft") // draft | active | paused | ended | archived
  startsAt    DateTime?
  endsAt      DateTime?
  budget      Decimal?  @db.Decimal(12, 2) // in the business currency
  targetLeads Int?
  ownerId     String?   // BusinessUser id
  notes       String?   @db.Text
  aliases     Json?     // extra utm_campaign / ad campaign names that also count, e.g. ["spring-sale-26"]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([businessId, slug])
  @@index([businessId, status])
}
```
- `campaignId String?` (SetNull on delete) on `ContentPost`, `LeadFormDef`, `LeadMagnet`, `LandingPage`, `BookingType`, `Touchpoint` and, in later workstreams, `TrackedLink`, `EmailCampaign` and `AdCampaignLink`.
- A `campaignLimit` plan limit (active campaigns; 0 = unlimited) with a console override.

### Design
- **Migration of `campaignTag`:** for each distinct `(businessId, campaignTag)`, create a campaign named after the tag with `slug = campaignSlug(tag)`, status `active`, and set `ContentPost.campaignId`. Old touchpoints whose `campaign` equals a slug are linked too. `campaignTag` is kept, read-only, for one release and then dropped.
- **Linking:** each builder (Content Studio, Forms, Lead magnets, Booking types) gets a "Campaign" picker. Landing pages are platform-built, so the platform console sets their campaign; the tenant sees which pages belong to a campaign.
- **UTM:** `utmParams()` uses the linked campaign's slug for `utm_campaign`. Forms and booking pages carry `campaignId` in the embed so a submission is matched even with no UTM.
- **Touchpoint matching:** `recordTouch()` resolves `campaignId` in this order: an explicit id (form, booking, tracked link, email), then `utm_campaign` against slugs and aliases, then a Meta campaign mapping (AC). The lookup is cached per business for 60 seconds. A nightly `campaigns.rematch` job links unmatched touchpoints from the last 90 days, so an alias added later still counts.
- **Status:** `draft` campaigns can be planned but nothing tagged with them can be published; `ended` campaigns stop matching new UTM visits after a 30-day grace period (late clicks still count for a month).
- **Tenant UI:** a new *Campaigns* view (module `campaigns`, Pro, flag `campaigns_hub`): a list with status, dates, budget and a leads count, and a campaign page with tabs for Overview (AE), Assets (everything linked), Links (AB), Emails (AD) and Spend (AC).

### Done when
- Every existing `campaignTag` is a campaign, and its old leads show against it.
- A visit with `utm_campaign=<slug>` and a form submission from a campaign's form both land on the right campaign.

### As built
- **Schema:** `Campaign` (with `endedAt` for the 30-day grace period and `createdById`), `campaignId` with SetNull foreign keys on `ContentPost`, `LeadFormDef`, `LeadMagnet`, `LandingPage`, `BookingType` and `Touchpoint` (the relation field on `Touchpoint` is `matchedCampaign`, since `campaign` is the raw UTM text). `campaignLimit` on plans and overrides (10 by default, 0 = unlimited on Enterprise in the seed), counting draft, active and paused campaigns. Migration `20270104100000_campaigns`. The seed adds the `campaigns_hub` flag, off by default.
- **Code:** `src/lib/campaigns/rules.ts` (pure: schemas, slugs, aliases, the match index, the grace period) and `service.ts` (CRUD, linking, the 60-second match cache, `ensureTagCampaigns`, `rematchTouches`). `recordTouch` takes an optional `campaignId`; left undefined, it matches `utm_campaign`. `captureInbound` passes the campaign of the form (or the lead magnet it gates, which wins), the booking type, or the Calendly event type.
- **Tracking name changes:** not frozen, as planned. Instead a changed slug keeps the old one as an alias, so links already out there still count. Saving a new name or alias re-links the last 90 days straight away.
- **Linking:** the Content Studio's free-text tag is now a campaign picker (new post form and post header), and publishing tags links with the campaign's slug. Forms, lead magnets and booking types are added from the campaign's *Linked items* tab rather than a picker in each builder. Landing pages are linked only from the console. A post in a draft campaign can't be scheduled (`CAMPAIGN_DRAFT`).
- **Old tags:** each distinct `campaignTag` becomes an active campaign the first time the list loads (and in the nightly job); `campaignTag` is kept read-only.
- **Tenant UI:** *Campaigns* view (`campaigns-view.tsx`): list with counts and the limit, a create dialog, and a campaign page with Overview (leads by last touch, touches, linked items, budget, lead-target progress, breakdowns by kind and channel), Linked items and Settings (owner, dates, budget, target, tracking name, other names, notes, delete for admins). Assets, Links, Emails and Spend tabs arrive with AB–AE.
- **API:** `/api/campaigns` (GET, POST), `/api/campaigns/options`, `/api/campaigns/:id` (GET, PATCH, DELETE), `/api/campaigns/:id/assets` (POST), all in the `campaigns` module.
- **Console:** a Campaigns card in the tenant detail (`tenant-campaigns-card.tsx`, `/api/super-admin/businesses/:id/campaigns`): status per campaign, the campaign of each platform-built page, and "Re-match touches".
- **Jobs:** `campaigns.rematch`, nightly at 02:50 UTC. Campaigns are in the GDPR export.

---

## AB. Tracked links

### Design
```prisma
model TrackedLink {
  id          String   @id @default(cuid())
  businessId  String
  campaignId  String?
  code        String   @unique @db.VarChar(16) // the short path: /l/{code}
  label       String   @db.VarChar(160)        // "Flyer – March", "Partner newsletter"
  destination String   @db.Text                 // without UTM; tags are added on redirect
  source      String   @db.VarChar(80)          // utm_source, e.g. "flyer", "partner-x"
  medium      String   @db.VarChar(80)          // utm_medium, e.g. "print", "referral", "email"
  content     String?  @db.VarChar(120)
  clicks      Int      @default(0)
  status      String   @default("active")       // active | disabled
  createdAt   DateTime @default(now())

  @@index([businessId, campaignId])
}
```
- **Redirect:** `GET /l/{code}` adds the UTM tags (keeping any the destination already has), counts the click and answers 302. Bots (by user agent) are redirected but not counted. A white-label custom domain serves the same path.
- **Open-redirect guard:** a destination must be on one of the tenant's own hosts: a platform-built site domain, a Search Console property, a widget allowed origin, or a Danets hosted form or booking page. Anything else is refused when the link is saved. Disabled links show a plain "This link has expired" page.
- **QR codes:** each link has a downloadable PNG and SVG QR code (generated server-side, no third-party service).
- **Limit:** `trackedLinkLimit` (default 25 on Pro, 0 = unlimited on Enterprise).

### Done when
- A click on `/l/{code}` lands on the tenant's page with the right UTM tags, and a lead who converts in that visit is counted to the campaign.
- A link to a host the tenant doesn't own can't be saved.

---

## AC. Ad spend import

### Schema
```prisma
// A Meta ad account the tenant connected, through the existing Meta OAuth connection.
model AdAccount {
  id           String    @id @default(cuid())
  businessId   String
  connectionId String    // OAuthConnection
  platform     String    @default("meta") // meta (google_ads later)
  externalId   String    @db.VarChar(64)  // act_123…
  name         String    @db.VarChar(200)
  currency     String    @db.VarChar(3)
  status       String    @default("active") // active | lost_access | error
  syncedThrough DateTime? @db.Date
  lastError    String?   @db.Text

  @@unique([businessId, platform, externalId])
}

// Which ad-platform campaigns belong to which Danets campaign.
model AdCampaignLink {
  id          String  @id @default(cuid())
  businessId  String
  adAccountId String
  externalId  String  @db.VarChar(64) // Meta campaign id
  name        String  @db.VarChar(300)
  campaignId  String? // null = not mapped yet

  @@unique([adAccountId, externalId])
}

// One row per ad-platform campaign per day, or one manual entry.
model CampaignSpend {
  id          String   @id @default(cuid())
  businessId  String
  campaignId  String?
  adLinkId    String?  // null for manual / CSV rows
  date        DateTime @db.Date
  channel     String   // social_paid | paid_search | print | sponsorship | other
  spend       Decimal  @db.Decimal(12, 2) // converted to the business currency
  spendRaw    Decimal? @db.Decimal(12, 2) // in the ad account's currency
  impressions Int?
  clicks      Int?
  platformLeads Int?   // leads the ad platform reports (for comparison with ours)
  note        String?  @db.VarChar(200)

  @@unique([adLinkId, date])
  @@index([businessId, campaignId, date])
}
```

### Design
- **Connect:** the Meta connection asks for `ads_read` (added to the scopes once Meta approves it, the same way LinkedIn's Lead Sync scope is gated). The tenant picks which ad accounts to import. `adAccountLimit` defaults to 1 on Pro.
- **Sync:** an `ads.spend-sync` job runs daily per ad account. It calls `/{act}/insights` at campaign level with `time_increment=1`, for the last 3 days each run (Meta revises recent numbers) and a 90-day backfill on first connect, one month per job.
- **Mapping:** new Meta campaigns appear in the campaign's Spend tab as "unmapped". A Meta campaign is mapped automatically when its name matches a campaign's name, slug or alias, or when its Meta lead form (`MetaLeadForm`) is linked to the campaign. The tenant can map or unmap by hand. Lead Ads leads already fetch `campaign_id` (`meta-graph.ts`) but the touchpoint keeps only the name; AC adds `Touchpoint.adCampaignId` and stores it, so mapped ad leads count straight away.
- **Manual spend:** add a row (date, channel, amount, note) or upload a CSV (`date,channel,amount,note`) for print, sponsorships, Google Ads until AC covers it, and so on.
- **Currency:** there is no business currency or exchange-rate source today (quotes, payments and invoices each store their own `currency`). AC adds `Business.currency` (default USD, set in Settings) and an `fx.rates` job that stores the European Central Bank's daily reference rates. Spend is converted at the day's rate, and both values are kept.
- **Errors:** an expired token or removed permission sets `lost_access`, notifies the admins and shows a reconnect banner, like Phase 3's health checks.

### Done when
- After the backfill, a test ad account's daily spend matches Ads Manager for the same campaigns and dates.
- Ad leads and spend appear under the mapped campaign, and unmapped spend is listed for the tenant to assign.

---

## AD. Email campaigns

### Problem today
- Danets sends transactional email only (`src/lib/email.ts`: notifications, lead magnets, bookings, review requests). There is no newsletter or promotional email, no unsubscribe handling and no bounce handling.
- `Contact.consent.marketingEmail` exists and newsletter forms can set it, but nothing uses it.

### Schema
```prisma
model EmailCampaign {
  id          String    @id @default(cuid())
  businessId  String
  campaignId  String?
  subject     String    @db.VarChar(200)
  preheader   String?   @db.VarChar(200)
  body        Json      // blocks: heading | text | button | image | divider, rendered to HTML and text
  audience    Json      // { segment: "all_consented" | "leads" | "customers" | "tag", statuses?, tags?, sources?, excludeRecentDays? }
  status      String    @default("draft") // draft | pending_approval | scheduled | sending | sent | cancelled | failed
  scheduledFor DateTime?
  sentAt      DateTime?
  recipients  Int       @default(0)
  delivered   Int       @default(0)
  opens       Int       @default(0) // unique, approximate (Apple Mail privacy prefetches images)
  clicks      Int       @default(0) // unique
  bounces     Int       @default(0)
  complaints  Int       @default(0)
  unsubscribes Int      @default(0)
  aiGenerated Boolean   @default(false)
  createdById String?
  approvedById String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([businessId, status])
}

model EmailSend {
  id          String    @id @default(cuid())
  emailId     String
  contactId   String
  email       String    @db.VarChar(191)
  status      String    @default("queued") // queued | sent | delivered | bounced | complained | failed | suppressed
  providerId  String?   @db.VarChar(191)
  openedAt    DateTime?
  clickedAt   DateTime?
  error       String?   @db.VarChar(500)

  @@unique([emailId, contactId])
  @@index([providerId])
}

// Addresses that must never get marketing email from this business again.
model EmailSuppression {
  id         String   @id @default(cuid())
  businessId String
  email      String   @db.VarChar(191)
  reason     String   // unsubscribed | hard_bounce | complaint | manual
  createdAt  DateTime @default(now())

  @@unique([businessId, email])
}
```

### Design
- **Audience:** only contacts with `consent.marketingEmail.granted`, minus the suppression list, minus anyone emailed by this business in the last N days if set. The audience size is shown before sending. Importing a list doesn't grant consent; imported contacts need a confirmed opt-in (a double-opt-in email from a newsletter form) before they're included.
- **Writing:** a block editor with a live preview, plus "Draft with AI" from a brief, using Brand Voice and the tenant's model. Links in the body go through AB's redirect, so every click is an `email_click` touchpoint matched to the campaign. A test send goes to the current user.
- **Sending:** an `email.send` job splits the audience into batches of 100 and respects a per-tenant hourly rate (plan-based) and the provider's limits. Each message gets `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, a visible unsubscribe link, the business's postal address in the footer (required by CAN-SPAM; asked for on first send) and the white-label sender name. From address: the platform's sending domain with the tenant's name, or the tenant's own domain once its DKIM is verified (open decision 3).
- **Events:** a provider webhook (SendGrid event webhook first; SMTP gets sent and failed only) updates `EmailSend`. Hard bounces and complaints add the address to the suppression list. A tenant whose complaint rate passes 0.3% or bounce rate passes 5% on a send is paused automatically, and the platform is notified.
- **Unsubscribe page:** `/u/{token}` (signed, no login) unsubscribes in one click, records it on the contact's consent and the suppression list, and offers "resubscribe" in case it was a mistake.
- **Limits:** `emailSendLimit` (marketing emails per month: 0 on Free and Starter, 5,000 on Pro, 0 = unlimited on Enterprise), counted when sent.
- **GDPR:** sends, opens and clicks are in the contact's export and erased with it; the suppression entry is kept as a hash of the address so the person isn't emailed again.

### Done when
- A test email to a seeded audience goes only to consented, unsuppressed contacts, with working one-click unsubscribe (checked with Gmail's header).
- A simulated bounce and complaint from the provider's webhook suppress the address and update the counts.
- A click in the email produces an `email_click` touchpoint on the right campaign.

---

## AE. Campaign results

### Design
- **Attribution models:** first touch, last touch (the default, matching `Lead.lastTouchId`) and linear (each campaign touch in the 90 days before the lead gets an equal share). Only touches with a `campaignId` count; a lead with none is "no campaign". The model can be switched on the dashboard and is saved per user.
- **Numbers per campaign:**
  - reach: post impressions (M), email recipients and opens, link clicks, ad impressions and clicks (AC)
  - results: visits, leads, bookings, form submissions, magnet downloads, won deals and revenue (`dealValue` of leads marked won)
  - cost: spend (AC plus manual), cost per lead, cost per booking, ROAS (revenue ÷ spend), and progress against `budget` and `targetLeads`
- **Views:**
  - the campaign Overview tab: headline tiles, leads and spend over time (one chart each, no dual axis), a channel breakdown and the top assets (posts, forms, links, emails) by leads
  - a *Compare* page: campaigns side by side for a date range
  - the lead journey (`lead-journey.tsx`) shows the campaign name on each touch
- **Insights and reports:** the weekly AI insights note (M) gets a short campaign summary (best and worst cost per lead, campaigns over budget). The monthly report (Z) gets a campaigns section when the tenant has the module.
- **Performance:** a nightly `campaigns.rollup` job writes `CampaignDaily` rows (campaign, date, channel, visits, leads, bookings, won, revenue, spend) so the dashboard never scans touchpoints live. Today's numbers are computed on the fly and added.

### Done when
- A seeded campaign with posts, a form, a link, an email and spend shows numbers that match hand counts for each attribution model.
- Switching the model changes lead counts but never spend.

---

## AF. AI campaign planner

### Design
- **Input:** goal (leads, bookings, sales, awareness), offer or topic, audience, dates, budget and channels the tenant uses (connected social accounts, email if allowed, ads if connected).
- **Output (structured JSON, the tenant's model):** a summary and key message; a post schedule (one `ContentPost` per idea, with platform variants, drafted and placed on the calendar as drafts); one email draft (AD); a suggested form or lead magnet; a landing page brief; a budget split by channel; and target numbers based on the tenant's own past cost per lead where it has one.
- **Everything is a draft:** nothing is scheduled, sent or published by the planner. The tenant reviews the plan, unticks what they don't want and clicks "Create drafts". The landing page brief becomes a request to the platform (a new *Page requests* list in the console's Sites panel), never a page.
- **Usage:** one plan uses the `plan` task and counts toward AI usage like any other generator.

### Done when
- A plan for a seeded tenant creates draft posts, an email draft and a page request, all linked to a new draft campaign, with nothing scheduled or sent.

---

## Cross-cutting

- **Packaging:**
  - Everything is in the `campaigns` module (Pro, flag `campaigns_hub`), which is already reserved in `module-registry.ts`. Email campaigns need the Pro plan and a sending limit above zero.
  - New limits: `campaignLimit`, `trackedLinkLimit`, `adAccountLimit` and `emailSendLimit`, with seed defaults and console overrides.
- **Platform console:**
  - a tenant Campaigns card: campaigns, connected ad accounts and their sync state, email sends this month, bounce and complaint rates, and a "pause email" switch
  - a platform Email page: sending domain status (SPF, DKIM, DMARC checks), the provider webhook's last event, tenants paused for complaints
  - the Sites panel gains a *Page requests* list for AF's landing page briefs
- **Jobs:** `campaigns.rematch`, `campaigns.rollup`, `ads.spend-sync`, `email.send` and `email.events`, on the existing queue with per-tenant concurrency of 1 and backoff on 429 and 5xx responses.
- **Automations:**
  - new triggers: `campaign_lead` (a lead attributed to a chosen campaign), `email_clicked`, `unsubscribed`
  - new actions: `add_to_campaign` (link a lead's next touch to a campaign), `stop_email` (add to suppression)
- **Security:**
  - tracked links redirect only to the tenant's own hosts
  - unsubscribe tokens are signed and scoped to one contact and business
  - the email event webhook checks the provider's signature
  - ad tokens stay in the encrypted `OAuthConnection` store; only `ads_read` is asked for, never write access to ads
- **Privacy:** marketing email only with recorded consent; unsubscribes honoured immediately; email engagement in the GDPR export and erased with the contact.
- **Testing:**
  - unit tests for slug and alias matching, the open-redirect guard, UTM merging, the attribution models, audience filtering, suppression, currency conversion and the CSV parser
  - recorded-fixture tests for Meta insights and the email provider's events (no live calls in CI)
  - one end-to-end test: campaign → tracked link click → form submission → lead counted, with spend and CPL
- **Docs:** `DEPLOYMENT.md` sections for the sending domain (SPF, DKIM, DMARC), the email event webhook, Meta `ads_read` review and the `/l` and `/u` routes on custom domains.

## Open decisions (owner: product)

**Decided 2026-11-28:** the recommended answer for 1–5, and for 6, track opens with a pixel, labelled as approximate.


1. **Plan placement:** keep all of Campaigns on Pro (recommended), or give Starter campaign records and tracked links, with spend, email and the planner on Pro?
2. **Google Ads:** add Google Ads spend in this phase (needs a developer token and Google's approval, about a week more), or leave it to manual and CSV spend for now (recommended)?
3. **Sender domain:** send all tenant marketing email from the platform's domain (simpler, one reputation to protect), or let tenants verify their own domain (better deliverability and branding, more support)? Recommended: platform domain first, own domain on Enterprise.
4. **Email provider:** SendGrid only for marketing email (it has the event webhook), or also support SMTP with no bounce tracking? Recommended: SendGrid only for marketing; SMTP stays for transactional.
5. **Default attribution model:** last touch (recommended, matches today's lead source), first touch, or linear?
6. **Open tracking:** track opens with a pixel (shown as approximate), or report clicks only?
