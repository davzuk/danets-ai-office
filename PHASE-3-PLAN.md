# Phase 3: Search & Local Visibility

**Date:** 2026-11-27
**Status:** U, V, W and X built and committed. Y and Z not started.
**Goal:** Show tenants how people find them on Google and help them get found more. That covers how their website performs in search, what is broken on it, and their Google Business Profile (reviews, posts, calls and directions). Each part links back to the leads it brings in.
**Builds on:**
- **Phase 0:** OAuth connections (C, the Google provider already asks for `webmasters.readonly` and `business.manage`), the job queue (B), contacts and attribution (D, `organic_search` touchpoints), Brand Voice (E) and the AI provider layer (A).
- **Phase 1:** the Content Studio and calendar (J, K) for Business Profile posts, the approval flow, and weekly AI insights (M).
- **Phase 2:** booking (P) and forms (S) as moments to ask for a review; platform-built sites (Q, R), whose pages Search Console also covers.

**Product rule carried over:** tenants don't edit websites in Danets (see `PLATFORM-SITES-REWORK-PLAN.md`). Phase 3 reports on any website the tenant owns and suggests fixes. It never publishes to it. For a platform-built site, the platform applies fixes in the console.

| # | Workstream | Delivers | Est. (1 dev) |
|---|---|---|---|
| U | Google property setup | Connect Google, pick the Search Console property and Business Profile locations, health checks | 2–3 days |
| V | Search performance | Daily Search Console sync, clicks/impressions/CTR/position over time, top queries and pages, organic leads per page | 4–5 days |
| W | Site audit | A safe crawler for the tenant's site, on-page and technical issues, Core Web Vitals from PageSpeed, AI-suggested fixes | 5–6 days |
| X | Google Business Profile | Reviews inbox with AI replies, review requests after bookings, profile posts from the content calendar, local performance metrics | 6–7 days (+ API access approval) |
| Y | Keywords and content opportunities | Tracked keywords from Search Console data, "almost page one" queries, AI content briefs | 3–4 days |
| Z | SEO reporting | Monthly white-label SEO report (page and PDF), SEO lines in weekly insights | 2–3 days |

**Order:** U first, since every other workstream needs a mapped property. Then V and W (W needs no Google connection, so it can start in parallel), then Y (built on V's data), X (start once Google approves API access) and Z last.
**Total:** about 5–6 weeks for one developer, or 3–4 weeks with two (one on U→V→Y→Z, one on W then X).

**External lead time (start in week 1):**
- **Google OAuth verification** for `webmasters.readonly` and `business.manage`. Submit them with Phase 2's Calendar scopes if that review is still open. Both are sensitive scopes, so the review needs a privacy policy, a demo video and a few weeks.
- **Business Profile API access.** These APIs are gated: a project has zero quota until Google approves an access request. Apply in week 1. X can't be tested against real locations until then.
- **PageSpeed Insights API key** (platform-level, free quota), in `PAGESPEED_API_KEY`.

> **Verify before building:** Google's Business Profile APIs are split across several services. Some methods (reviews, local posts) still use the older `mybusiness.googleapis.com/v4` API, and Google retires features from time to time. Check each endpoint below against the current docs before X starts.

---

## U. Google property setup

### Problem today
- Tenants can connect Google (Phase 0 C) and the token has the right scopes, but nothing uses it. We don't know which Search Console property or which Business Profile locations belong to the tenant.

### Schema
```prisma
model SearchProperty {
  id            String   @id @default(cuid())
  businessId    String
  connectionId  String   // OAuthConnection (google)
  siteUrl       String   @db.VarChar(300) // "sc-domain:example.com" or "https://www.example.com/"
  permission    String   // siteOwner | siteFullUser | siteRestrictedUser
  status        String   @default("active") // active | lost_access | error
  lastSyncedAt  DateTime?
  syncedThrough DateTime? @db.Date // the last day with complete data (Search Console lags 2–3 days)
  error         String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@unique([businessId, siteUrl])
}

model BusinessLocation {
  id            String   @id @default(cuid())
  businessId    String
  connectionId  String
  accountName   String   @db.VarChar(120) // accounts/{id}
  locationName  String   @db.VarChar(120) // locations/{id}
  title         String
  address       String?  @db.Text
  mapsUri       String?  @db.Text
  reviewUri     String?  @db.Text // where "leave a review" links go
  status        String   @default("active")
  lastSyncedAt  DateTime?
  createdAt     DateTime @default(now())

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@unique([businessId, locationName])
}
```

### Design
- **Setup wizard (SEO → Setup):** connect Google (or reuse the connection), then:
  - **Search Console:** list properties (`GET webmasters/v3/sites`) and pick one. A domain property (`sc-domain:`) is preferred because it covers every subdomain and protocol. If the tenant has a platform-built site, mention that it needs its own property, or that the platform can add it.
  - **Business Profile:** list accounts (Account Management API) and their locations (Business Information API, `readMask=name,title,storefrontAddress,metadata`). Tick the ones to manage, up to the plan limit.
- **Health:** a daily `seo.health` job checks each property and location still answers. On 403 or 404 it sets `lost_access` and shows a banner ("Reconnect Google, or ask the property owner to add <email>").
- **Module and limits:** everything sits in the existing `seo` module (Pro, flag `seo_hub`). New limits `seoPropertyLimit` (default 1) and `gbpLocationLimit` (Pro 1, Enterprise 10) on `SubscriptionPlan` and `BusinessLimitOverride`, editable in the platform console like every other limit.

### Done when
- A tenant with a test Google account can connect, pick a property and a location, and see both as healthy. Removing their access in Search Console shows the reconnect banner after the next health run.

### As built
- **Schema:** `SearchProperty` and `BusinessLocation` (migration `20261227100000_seo_properties`), plus `seoPropertyLimit` and `gbpLocationLimit` (both default 1) on `SubscriptionPlan`, nullable on `BusinessLimitOverride`. Both limits appear in the console limit editors through `LIMIT_FIELDS`. Quota resources are `seoProperties` and `gbpLocations`.
- **Google calls:** `src/lib/seo/google.ts` lists and gets Search Console sites and Business Profile accounts and locations, and sorts Google failures into lost access, API not approved, or retry.
- **Setup logic:** `src/lib/seo/setup.ts` covers setup data, the pickers, add and remove (quota-checked and activity-logged) and health checks. A check notifies the tenant once when an item stops working.
- **Connect:** `/api/connections/google/start?purpose=seo` asks for the Search Console and Business Profile scopes and returns to the SEO view.
- **Tenant:** SEO nav item and view (`?view=seo`) with the Google, Search Console and Business Profile cards. Admins add and remove items; anyone can run "Check access".
- **Routes:** `/api/seo/setup`, `/api/seo/google/sites`, `/api/seo/google/locations`, `/api/seo/properties[/id]`, `/api/seo/locations[/id]` and `/api/seo/check`. All are gated by the `seo` module.
- **Console:** an "SEO setup" card on the tenant detail can re-check items or clear them.
- **Job:** `seo.health` runs daily, skipping tenants without the module. The GDPR export includes both tables.
- **Not verified live:** no Google OAuth credentials are set up locally, so real Google calls are untested. Business Profile APIs need Google's access approval for the project before they answer; until then locations show a "hasn't enabled Business Profile" error.
- **Rollout note:** the `seo_hub` platform flag doesn't exist in the database yet, so the module is off for every tenant until an admin creates the flag in the console.

---

## V. Search performance

### Schema
```prisma
// One row per property, day and dimension slice. "query" and "page" are
// stored separately to keep rows small (Search Console anonymises rare
// queries anyway).
model SearchMetricDaily {
  id         String   @id @default(cuid())
  propertyId String
  date       DateTime @db.Date
  kind       String   // total | query | page | device | country
  key        String   @db.VarChar(500) // "" for total; the query, page URL, device or country
  clicks     Int
  impressions Int
  ctr        Float
  position   Float

  @@unique([propertyId, date, kind, key])
  @@index([propertyId, kind, date])
}
```

### Design
- **Sync:** an `seo.search-sync` job runs daily per property and calls `searchAnalytics/query` with `dataState: "final"`.
  - **Backfill:** 16 months on first connect, one month per job, so no single job runs long.
  - **Daily run:** from `syncedThrough + 1` to the last final day.
  - **Rows per day:** totals, plus the top 1,000 queries and top 1,000 pages by impressions (`rowLimit` paging), device and country.
  - **Retention:** query and page rows are kept for 16 months (matching Google), totals for 5 years. Old rows are pruned by `retention.ts`.
- **Dashboard (SEO → Performance):**
  - clicks, impressions, CTR and average position over time, compared with the previous period
  - top queries and pages, with filters by device and country
  - "Lost and gained" queries month over month
- **Leads from search:** join `Touchpoint` rows (`channel = organic_search`, `landingUrl`) with the page list. Each top page shows "leads from search" next to its clicks. This is the number tenants care about, and only Danets has both halves.
- **AI context:** the weekly insights job (M) gets a short search summary (clicks trend, top movers) so it can comment on search as well as social.
- **Quotas:** Search Console allows plenty of reads per property, but stay polite: one property at a time per tenant, with backoff on 429.

### Done when
- After the backfill, totals for a test property match the Search Console UI for the same range and filters (allowing for its rounding).
- Organic leads show against the page they landed on.

### As built
- **Schema:** migration `20261228100000_search_metrics` creates `SearchMetricDaily` (one row per property, day and dimension slice; `kind` = total | query | page | device | country, `key` = "" for total or the query/page URL/device/country), plus the `metrics` back-relation on `SearchProperty` so deleting a property clears its data.
- **Google call:** `searchAnalyticsQuery` in `src/lib/seo/google.ts` POSTs `searchAnalytics/query` with `dataState: "final"` and pages with `startRow`.
- **Sync:** `src/lib/seo/search.ts` holds the pure date/window/row helpers and the DB work. `syncWindow` fetches one window's five slices (date, query+date, page+date, device+date, country+date), trims query and page to the top 1,000 per day by impressions, and re-inserts the window in one transaction (delete-then-insert, so retries are clean). `windowsFor` returns the 16-month backfill on first connect and the daily gap afterward, chunked into calendar months so no single job runs long. `pruneSearchMetrics` keeps query/page/device/country for 16 months and totals for 5 years.
- **Jobs:** `seo.search-sync` (daily driver: enqueues each property's missing windows with dedupe keys, then prunes) and `seo.search-sync-window` (one window of one property), in `src/lib/jobs/handlers/seo-search-sync.ts`, both registered and the driver scheduled at 06:30 UTC.
- **Dashboard:** `/api/seo/performance` + `performanceData` read only from `SearchMetricDaily` (never wait on Google): clicks, impressions, CTR and average position with previous-period deltas, a day-by-day series, top queries with month-over-month gain/loss, top pages with **leads from search** (distinct contacts with a `channel = organic_search` touchpoint on that page; anonymous visits don't count; Search Console page and landing URL are matched ignoring case, query string and trailing slash), and device/country breakdowns.
- **Tenant UI:** the SEO view now has Setup / Performance tabs; `seo-performance-view.tsx` renders the 7/28/90-day range, property selector, KPI cards, chart, top queries/pages and breakdowns.
- **AI context:** `searchSummary` writes a short "clicks trend + top movers" paragraph that `social/insights.ts` folds into the weekly content insight, so the note can comment on search as well as social.
- **Not verified live:** no Google OAuth credentials are set up locally, so real Search Console calls are untested (same as U). By design the sync lags 3 days behind today so only final data is stored, and "top 1,000 by impressions" is computed from the rows Google returns (which are sorted by clicks — the API has no sort parameter); for very large sites the true by-impressions top can sit beyond the 25,000-row fetch cap.

---

## W. Site audit

### Problem today
- Tenants can't see what is wrong with their website. Danets has no crawler, no HTML parser and no SSRF-safe fetcher.

### Schema
```prisma
model SiteAudit {
  id          String    @id @default(cuid())
  businessId  String
  rootUrl     String    @db.VarChar(300)
  status      String    @default("queued") // queued | running | done | failed
  pagesCrawled Int      @default(0)
  score       Int?      // 0–100, from issue weights
  summary     Json?     // counts by severity and category
  startedAt   DateTime?
  finishedAt  DateTime?
  error       String?   @db.Text
  createdAt   DateTime  @default(now())

  issues AuditIssue[]
  @@index([businessId, createdAt])
}

model AuditIssue {
  id        String  @id @default(cuid())
  auditId   String
  pageUrl   String  @db.VarChar(1000)
  code      String  // missing_title | duplicate_title | title_too_long | missing_meta_description | missing_h1 | multiple_h1 | broken_link | redirect_chain | missing_alt | noindex | missing_canonical | slow_lcp | high_cls | no_https | mixed_content | missing_structured_data | thin_content | ...
  severity  String  // critical | warning | notice
  detail    Json?   // e.g. { link, status } or { current, length }
  suggestion String? @db.Text // AI-written fix, filled on demand

  audit SiteAudit @relation(fields: [auditId], references: [id], onDelete: Cascade)
  @@index([auditId, severity])
}
```

### Design
- **Which site:** the Search Console property's URL, else the widget's allowed origins, else a URL the tenant enters. The domain must belong to the tenant: it must be in their Search Console property, their widget origins or their platform-built site. This stops Danets being used to crawl arbitrary sites.
- **Safe fetcher** (`src/lib/seo/fetch.ts`), the part that needs the most care:
  - resolve DNS and refuse private, loopback, link-local and metadata addresses, checking again after every redirect (no DNS-rebinding window)
  - `http(s)` only, ports 80 and 443 only, at most 5 redirects, only within the audited site
  - 10 s timeout, 2 MB body cap, HTML only for parsing
  - user agent `DanetsAuditBot/1.0 (+<app>/bot)`, obeys `robots.txt` (`Disallow` and `Crawl-delay`), one request at a time per site
- **Crawler:** a `seo.audit` job does a breadth-first crawl from the root and `sitemap.xml`. It stops at the plan's page cap (`auditPageLimit`: Pro 200, Enterprise 1,000) and checkpoints every 25 pages, so a restart resumes. Links to other sites are checked with `HEAD` (falling back to `GET`) for broken links only.
- **Parser:** add `htmlparser2` (small, no DOM) to extract title, meta, canonical, robots, headings, links, images, JSON-LD and word count.
- **Core Web Vitals:** the PageSpeed Insights API (`runPagespeed`, mobile strategy) for the home page and the five top pages from V, using the field (CrUX) data when there is enough traffic and lab data otherwise. LCP, INP and CLS are flagged against Google's "good" thresholds.
- **Score:** 100 minus weighted issue counts, capped per code so one repeated issue can't zero the score. The weights live in one table and are unit-tested.
- **AI fixes:** "Suggest a fix" on title, meta description, H1 and alt-text issues writes a suggestion from the page's text and the brand voice (`aiStructured`, tenant's provider and quota, feature `seo_fix`). It's a suggestion to copy, since Danets doesn't edit the site. On platform-built sites, the platform console shows the same issues and can apply fixes in the builder.
- **Schedule:** a monthly re-audit (on/off), with a "Run now" button rate-limited to once per hour. The dashboard shows new and fixed issues since the last audit.

### Done when
- An audit of a local test site with planted problems finds every planted issue, with no false positives on a clean page.
- The fetcher refuses `127.0.0.1`, `10.x`, `169.254.169.254`, `[::1]`, a public name that resolves to a private address, and a redirect to any of these (unit tests plus one integration test).
- A 200-page crawl finishes within the job timeout and resumes after the worker is killed halfway.

### As built
- **Schema** (migration `20261229100000_site_audit`):
  - `SeoSettings`: the site to audit and the monthly on/off switch.
  - `SiteAudit`: adds `trigger`, `pageLimit`, `vitals`, `state` (the crawl checkpoint) and `requestedBy` to the planned fields.
  - `AuditIssue`: adds `suggestedAt`.
  - `auditPageLimit` on plans (default 200; Enterprise set to 1,000 by the migration and the seed) and on tenant overrides. It shows in the console limit editors.
- **Safe fetcher** (`src/lib/seo/fetch.ts`):
  - Every hostname goes through our own DNS lookup, which refuses the whole answer if any address isn't public. The socket connects only to the checked addresses.
  - IP literals are checked directly: private, loopback, link-local, metadata, CGNAT, multicast and reserved ranges, IPv4-mapped/NAT64/6to4 IPv6, and numeric hosts.
  - Redirects are followed by hand: at most 5, each re-checked and limited to the tenant's own hosts.
  - http(s) only, ports 80/443 only, no credentials in URLs.
  - 10 s timeout, 2 MB body cap; gzip, deflate and brotli are handled.
  - User agent `DanetsAuditBot/1.0 (+<app>/bot)`.
  - A test-only escape hatch (`allowPrivate`, or `SEO_AUDIT_ALLOW_PRIVATE=1`) is ignored in production.
- **robots.txt and sitemaps** (`robots.ts`): RFC 9309 rules (the bot's own group else `*`, longest match, Allow wins ties, `*` and `$`), `Crawl-delay` (capped at 10 s), and sitemaps (one sitemap index level, at most 5 files).
- **Parser** (`html.ts`, `htmlparser2@12.0.0`): title, meta description and robots, X-Robots-Tag, canonical, lang, viewport, H1s, links, images and alt text, mixed content, JSON-LD and word count.
- **Rules and score** (`audit-rules.ts`): one table of 24 issue kinds with severity, help text, weight and per-kind cap. Poor Core Web Vitals count double.
- **Crawler** (`audit.ts` + the `seo.audit` job):
  - **Scope:** breadth-first from the root and the sitemap, staying on the root's host. It stops at the page limit, a depth of 10, nofollow and robots.txt.
  - **Pacing:** one request at a time, at least 250 ms apart.
  - **Links:** up to 200 links to files and other sites are checked with HEAD (GET when HEAD isn't supported).
  - **Runs:** each run works for 4 minutes, checkpointing every 25 pages (state and issues in one transaction), then queues the next run. A killed worker resumes from the last checkpoint.
  - **Phases:** crawl, links, vitals, then finish (duplicates, broken links, redirect chains, error pages, score).
  - **Afterwards:** the tenant gets a notification and only the last 12 audits are kept.
- **Ownership:** only hosts from the tenant's Search Console properties (domain properties include subdomains), chat-widget allowed origins (plus the www twin) and their platform-built site can be audited. The check runs again before each crawl.
- **Core Web Vitals:** PageSpeed Insights (mobile) on the home page and the top 5 pages from V. It uses field data when there's enough, else lab data (lab has no INP). It runs only when `PAGESPEED_API_KEY` is set; otherwise the audit says so.
- **AI fixes:**
  - "Suggest a fix" works on title, description, H1 and alt-text issues.
  - It re-reads the page through the safe fetcher, then calls `aiStructured` with the brand voice on the tenant's provider and quota (`requireAiQuota`, usage feature `seo_fix`).
  - The result is stored on the issue for the tenant to copy.
- **Schedule:** `seo.audit-schedule` runs daily at 03:40 UTC. It starts the monthly re-audit 30 days after a tenant's last audit (unless they turned it off) and fails audits that made no progress for 6 hours. "Run audit" is limited to once an hour; the platform can run one any time.
- **Tenant UI:** SEO → Audit tab with:
  - the score, severity counts, and fixed/new issues and the score change since the last audit;
  - crawl notes and issues grouped worst first, each with the affected pages, details and suggested fixes;
  - Core Web Vitals, past audits, and settings (which site and monthly on/off).
- **Console and data:** the tenant SEO card shows the latest audit and its top issue kinds, with "Run audit". The GDPR export includes the audits. A notification type `site_audit_done` opens the Audit tab.
- **Tests:** `tests/unit/seo-audit.test.ts`:
  - **Address policy:** the plan's list of refused addresses.
  - **Fetcher:** a real local server with fake DNS: a name resolving to a private address, redirects to a private name or to `169.254.169.254`, redirect loops, the body cap.
  - **Robots and sitemaps,** the parser, the rules and score caps, and PageSpeed parsing.
  - **Fixture crawl:** every planted issue is found and the clean page has none. Resuming one page per run, and after a crash, gives identical results. A 200-page crawl stops at the limit. Vitals are added when PageSpeed is available.
- **Not done here:**
  - The free Starter teaser (open decision 2); SEO stays Pro-only.
  - Applying fixes in the platform builder: the console shows the issues, but the builder isn't linked to them.
  - A public `/bot` info page for the crawler (open decision 6).

---

## X. Google Business Profile

### Schema
```prisma
model GbpReview {
  id           String    @id @default(cuid())
  businessId   String
  locationId   String    // BusinessLocation
  reviewName   String    @db.VarChar(200) // accounts/../locations/../reviews/{id}
  reviewerName String?
  starRating   Int       // 1–5
  comment      String?   @db.Text
  createdAt    DateTime  // Google's createTime
  updatedAt    DateTime
  replyText    String?   @db.Text
  repliedAt    DateTime?
  replyStatus  String    @default("none") // none | draft | pending_approval | posted | failed
  draftReply   String?   @db.Text
  contactId    String?   // matched to a contact when the name/email lines up

  @@unique([locationId, reviewName])
  @@index([businessId, createdAt])
}

model GbpDailyMetric {
  id         String   @id @default(cuid())
  locationId String
  date       DateTime @db.Date
  metric     String   // BUSINESS_IMPRESSIONS_DESKTOP_MAPS | CALL_CLICKS | WEBSITE_CLICKS | BUSINESS_DIRECTION_REQUESTS | ...
  value      Int
  @@unique([locationId, date, metric])
}

model ReviewRequest {
  id         String    @id @default(cuid())
  businessId String
  locationId String
  contactId  String?
  leadId     String?
  channel    String    // email | whatsapp
  sentAt     DateTime  @default(now())
  clickedAt  DateTime?
  token      String    @unique // short redirect link, to count clicks
}
```

### Design
- **Reviews inbox (SEO → Reviews):**
  - An `gbp.reviews-sync` job runs every 2 hours per location (`GET v4 .../reviews`, newest first, stopping at the last seen).
  - New reviews notify the team. Reviews of 1–2 stars are urgent.
  - Filters: no reply yet, by rating, by location.
- **AI replies:**
  - "Draft reply" writes a reply in the brand voice that thanks by name, addresses the specific points and never makes promises or admits liability. Low-rated reviews get a calm reply that offers to take it offline, using the business's phone or email.
  - Replies go through the existing approval policy (`Business.contentApproval`) and post with `PUT .../reviews/{id}/reply`.
  - An optional auto-reply for 4–5-star reviews with no comment, off by default.
- **Review requests:**
  - A new automation action, `send_review_request` (email or WhatsApp), with a short tracked link to the location's review page.
  - Suggested triggers: `booking_completed` (new; fires after the meeting's end time) and a lead marked won.
  - Guardrails: once per contact per 90 days, never to opted-out contacts, and no review gating (the same link for everyone, which Google's policy requires).
- **Profile posts:** add `google_business` to `CONTENT_PLATFORMS`, so the Content Studio and calendar can write and schedule "What's new", offer and event posts (`localPosts`). The platform limits (1,500 characters, one image, a call-to-action button) go in `platforms.ts`, and publishing uses the existing `social-publish` job.
- **Performance:** a `gbp.metrics-sync` job runs daily (`fetchMultiDailyMetricsTimeSeries`) for impressions on Search and Maps, calls, website clicks and direction requests. They are shown next to V's search numbers.
- **Not in scope:** editing the profile itself (hours, categories, photos). Edits trigger Google re-verification and belong in Google's own UI. Danets links there instead.

### Done when
- With API access approved, a test location's reviews sync and a drafted reply posts after approval, and shows on Google.
- A completed booking sends one review request, and a second booking within 90 days doesn't.
- A scheduled Business Profile post publishes from the calendar.

### As built
- **Schema** (migration `20261230100000_google_business_profile`):
  - `GbpReview` as planned, plus reviewer photo and anonymity, Google's reply moderation state (`replyState`: PENDING, APPROVED or REJECTED), who drafted the reply, the last reply error and `autoReplied`.
  - `GbpDailyMetric` and `ReviewRequest` as planned. `ReviewRequest` also records the recipient, booking, workflow and click count.
  - `BusinessLocation` gains the average rating, review count, and reviews and performance sync state and errors. `SeoSettings.autoReplyNoText` is the auto-reply switch (off by default).
  - The migration backfills a `google_business` `SocialAccount` for each existing location.
- **Google client** (`src/lib/seo/gbp.ts`): reviews list (50 a page, `updateTime desc`), `PUT .../reply` (4,096 bytes), `localPosts`, and `fetchMultiDailyMetricsTimeSeries` for 8 metrics. `MESSAGING_CLICKS` replaces the deprecated `BUSINESS_CONVERSATIONS`. Endpoints were checked against Google's docs on 2026-11-27.
- **Reviews sync** (`reviews.ts`, `gbp.reviews-sync` every 2 hours, then one job per location):
  - It reads up to 10 pages on a location's first sync and 4 after that, stopping at the last review it has seen.
  - A reply found on Google counts as posted, including one written in Google's own UI. A reply deleted there resets the review to "no reply". A draft, or a reply waiting for approval, is left alone.
  - The first sync is quiet. After that, new reviews notify the team (1–2 stars are urgent), fire the new `review_received` trigger, and get the auto-reply when it's on.
  - Reviewers are matched to a contact only when exactly one contact has the same name.
- **Replies:**
  - "Draft reply" uses `aiStructured` with the brand voice on the tenant's provider and quota (usage feature `gbp_reply`). Drafts that use a banned phrase are flagged.
  - Posting follows `Business.contentApproval`, like posts do. A reply that needs approval notifies admins and opens the Reviews tab.
  - The auto-reply uses 3 fixed thank-you templates, not AI. Under "every post needs approval", auto-replies wait for an admin too.
- **Review requests** (`review-requests.ts`, the `send_review_request` action):
  - Sent by email or WhatsApp, with a tracked link `/r/{token}` that redirects only to Google's own hosts (google.com, g.page, goo.gl).
  - Each person is asked at most once per 90 days, matched by contact or by recipient. Nobody who refused consent for the channel is asked. There is no review gating.
  - The cooldown is reserved before sending and released if sending fails.
- **Triggers:**
  - `booking_completed` fires 30 minutes after a booking's end time, unless the booking was cancelled (job `booking.complete`).
  - `review_received` can filter on a rating range.
  - The `lead_status_changed` status picker now filters as its card said it did (a status of "won" covers "a lead marked won").
- **Profile posts:** `google_business` is a content platform (1,500 characters, one photo, no video, no hashtags). Each location has its own `SocialAccount`, kept in step with it when it's added, removed or re-checked. Posts publish through the existing calendar and publish job as "What's new" posts. A link becomes a Book button for booking pages and Learn more otherwise.
- **Performance** (`gbp-metrics.ts`, `gbp.metrics-sync` daily at 07:10 UTC):
  - The first sync backfills 180 days. Later syncs re-read the last 7 days, because Google revises recent figures. Data is kept for 550 days.
  - The Performance tab shows views on Search and Maps, calls, website clicks, directions and messages, with the change from the previous period, a daily chart and a per-location breakdown.
- **Tenant UI:** SEO → Reviews tab:
  - counts, plus review-request sends and clicks over the last 30 days;
  - filters (no reply, needs approval, low ratings, rating, location);
  - draft, edit, post, approve and discard, with Google's moderation state;
  - the auto-reply setting.

  The automations editor has the two new triggers and the new action.
- **Console and data:** each location on the tenant SEO card shows its rating, unreplied and awaiting-approval counts, sync errors and a "Sync reviews" action. The GDPR export includes reviews, review requests and daily metrics.
- **Tests:** `tests/unit/seo-gbp.test.ts` covers:
  - review, page, reply-size and metrics mapping against Google's documented response shapes;
  - the sync row rules, auto-reply eligibility and templates, and reply approval decisions;
  - the reply prompt, local post building and publish error sorting;
  - the metrics window, grouping and daily series, and the trigger filters;
  - review requests: the same link for everyone, the cooldown, consent, a failed send releasing the cooldown, the module, location and WhatsApp checks, and the redirect host check.
- **Not done here:**
  - Offer and event posts. Only "What's new" posts are supported.
  - Live verification. It needs Business Profile API access approved for the Google project, so none of the "Done when" checks have been run against Google yet.

---

## Y. Keywords and content opportunities

### Schema
```prisma
model TrackedKeyword {
  id         String   @id @default(cuid())
  businessId String
  propertyId String
  keyword    String   @db.VarChar(200)
  targetUrl  String?  @db.VarChar(1000)
  createdAt  DateTime @default(now())
  @@unique([propertyId, keyword])
}
```

### Design
- **Positions come from Search Console only.** There's no paid rank-tracking API. Positions are the average Google reports for impressions the site actually got, which is honest and free. The UI says so ("average position when you appeared"), and a keyword with no impressions shows "Not ranking yet".
- **Tracked keywords:** add from top queries or type them in, up to `trackedKeywordLimit` (Pro 50, Enterprise 500). History comes from V's query rows, with no extra API calls.
- **Opportunities**, computed weekly from V's data:
  - **Almost page one:** queries at an average position of 8–20 with real impressions.
  - **Low CTR:** queries ranking in the top 5 with CTR well below the norm for that position. Their title or description needs work, which links to W's suggestion tool.
  - **Cannibalisation:** one query split across several pages.
- **AI content briefs:** from an opportunity, the AI writes a brief: the search intent, a suggested title and H1, an outline, questions to answer (from the query cluster) and facts to use (from the knowledge base). The brief marks anything it can't support with `[Add …]`, as R does.
  - It's a document to copy or download (Markdown or PDF), since tenants don't publish through Danets.
  - For a platform-built site, the platform console can turn the brief into an R prompt.
  - Cost: tenant's provider and quota, feature `seo_brief`.

### Done when
- Opportunities on a fixture dataset match a hand-computed list.
- A brief for a test query uses only knowledge-base facts and marks the gaps.

---

## Z. SEO reporting

### Design
- **Monthly report:** a `seo.report` job runs on the 3rd of each month, after Search Console data is final. It covers:
  - search clicks and leads
  - top movers
  - the audit score and fixed issues
  - reviews (count, average rating, reply rate)
  - Business Profile actions
  - three AI-written "do this next" points
- **Formats:** a page in the app and a PDF (rendered with `@react-pdf/renderer`, as lead magnets are), emailed to admins. It's white-labelled with the tenant's brand when they have white-label, so agencies can forward it to their own clients.
- **Weekly insights:** add search and review lines to M's weekly summary.

### Done when
- The report for a seeded month matches the dashboard numbers and renders with the tenant's white-label branding.

---

## Cross-cutting

- **Packaging:**
  - Everything is in the `seo` module (Pro, flag `seo_hub`). The audit's first run is free on Starter as a teaser (one audit, 25 pages, no schedule) to show the value.
  - New limits: `seoPropertyLimit`, `gbpLocationLimit`, `auditPageLimit` and `trackedKeywordLimit`, with seed defaults and console overrides.
- **Platform console:**
  - a tenant SEO tab showing connected properties and locations, the last sync and audit, and errors, with "re-sync" and "clear"
  - the platform's own PageSpeed key and usage
- **Jobs:** `seo.health`, `seo.search-sync`, `seo.audit`, `gbp.reviews-sync`, `gbp.metrics-sync` and `seo.report`, all on the existing queue with per-tenant concurrency of 1 and backoff on Google 429 and 5xx responses.
- **Automations:**
  - new triggers: `review_received` (with a rating filter), `booking_completed`
  - new action: `send_review_request`
- **Security:**
  - the SSRF-safe fetcher (W) is the only way the server fetches tenant URLs
  - tokens stay in the encrypted `OAuthConnection` store
  - review replies and posts are written to Google only by the tenant's own connection, after approval when approval is on
- **Privacy:**
  - Search Console query data is aggregated and anonymised by Google
  - reviewer names are public data but are still included in the GDPR export and erased with the contact
- **Testing:**
  - unit tests for the fetcher's address checks, robots.txt parsing, issue rules, score weights, opportunity maths and the review-request cooldown
  - recorded-fixture tests for every Google API response shape (no live calls in CI)
  - one crawl integration test against a local fixture site
- **Docs:** `DEPLOYMENT.md` sections for the Google Cloud project (APIs to enable, OAuth consent screen, Business Profile access request), `PAGESPEED_API_KEY` and the crawler's bot page.

## Open decisions (owner: product)

1. **Plan placement:** keep all of SEO on Pro (recommended), or put the site audit and search performance on Starter and only Business Profile on Pro?
2. **Free audit teaser:** offer the one-off 25-page audit to Starter (and Free?) tenants as an upgrade prompt?
3. **Auto-reply to reviews:** allow automatic replies to 4–5-star reviews with no text (off by default), or always require a human?
4. **Paid rank data:** Search Console positions only (recommended), or add a paid SERP API later for keywords the site doesn't rank for yet?
5. **Platform-built sites:** should the platform register a Search Console property for each platform-built site automatically (a platform-owned Google account adding the tenant as a user), so tenants without their own website still get V and Y?
6. **Bot identity:** the crawler's name and info page URL, and whether to publish its IP range.
