import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Marketing attribution: classify where a visitor came from and record
 * touchpoints. Pure helpers (classify/sanitise) are separate from the DB
 * writers so they can be unit-tested without MySQL.
 */

export const CHANNELS = [
  "organic_search",
  "paid_search",
  "social_organic",
  "social_paid",
  "email",
  "referral",
  "direct",
  "whatsapp",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const TOUCH_KINDS = ["visit", "chat_start", "form_submit", "ad_lead", "social_dm", "email_click", "booking"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];

export const CLICK_ID_TYPES = ["gclid", "gbraid", "wbraid", "dclid", "msclkid", "fbclid", "li_fat_id", "ttclid", "twclid"] as const;
export type ClickIdType = (typeof CLICK_ID_TYPES)[number];

const PAID_SEARCH_CLICK_IDS = new Set<string>(["gclid", "gbraid", "wbraid", "dclid", "msclkid"]);
const PAID_SOCIAL_CLICK_IDS = new Set<string>(["li_fat_id", "ttclid", "twclid"]);

// Host → canonical source name. Matched against the registrable part of the
// host (so "www.google.co.uk" and "l.facebook.com" both match).
const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)yahoo\.[a-z.]+$/, "yahoo"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)baidu\.com$/, "baidu"],
  [/(^|\.)yandex\.[a-z.]+$/, "yandex"],
  [/(^|\.)ecosia\.org$/, "ecosia"],
  [/^search\.brave\.com$/, "brave"],
  [/(^|\.)ask\.com$/, "ask"],
  [/(^|\.)aol\.[a-z.]+$/, "aol"],
];
const SOCIAL_NETWORKS: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "x"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)pinterest\.[a-z.]+$/, "pinterest"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)threads\.net$/, "threads"],
  [/(^|\.)snapchat\.com$/, "snapchat"],
];
const EMAIL_HOSTS = /^(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|mail\.proton\.me)$/;
const WHATSAPP_HOSTS = /(^|\.)(whatsapp\.com|wa\.me)$/;

const SOCIAL_SOURCE_NAMES = new Set([
  ...SOCIAL_NETWORKS.map(([, n]) => n),
  "fb", "ig", "twitter", "meta", "lnkd",
]);
const SEARCH_SOURCE_NAMES = new Set(SEARCH_ENGINES.map(([, n]) => n));
const EMAIL_SOURCE_NAMES = new Set(["email", "newsletter", "mailchimp", "sendgrid", "klaviyo", "brevo", "hubspot_email"]);

const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|cpa|cpp|paid|paid[_-]?(social|search|media)|paidsocial|ads?|display|banner|retargeting|sponsored)$/;
const SOCIAL_MEDIUM = /^(social|social[_-]?(media|network|organic)|sm|organic[_-]?social)$/;
const EMAIL_MEDIUM = /^(e[_-]?mail|newsletter)$/;

function match(list: [RegExp, string][], host: string): string | undefined {
  return list.find(([re]) => re.test(host))?.[1];
}

/** Lowercased host without "www.", or undefined for an unparseable URL. */
export function hostOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep only origin + path. Query strings and fragments can carry personal
 * data (emails, tokens, order ids); the UTM values we need are captured
 * separately, so nothing useful is lost.
 */
export function stripUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return (u.origin + u.pathname).slice(0, 2000);
  } catch {
    return null;
  }
}

export interface ClassifyInput {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  clickIdType?: string | null;
  referrer?: string | null;
  /** The page the visitor landed on; referrers from the same host are self-referrals. */
  landingUrl?: string | null;
}

export interface Classification {
  channel: Channel;
  source: string | null;
  medium: string | null;
}

/**
 * Map UTM tags, click ids and the referrer to a channel. Precedence:
 * explicit UTM tags, then ad click ids, then the referrer host, then direct.
 *
 * A social source tagged with a campaign but no medium counts as paid:
 * organic posts are rarely campaign-tagged, ads almost always are.
 */
export function classifyChannel(input: ClassifyInput): Classification {
  const source = input.source?.trim().toLowerCase() || null;
  const medium = input.medium?.trim().toLowerCase() || null;
  const campaign = input.campaign?.trim() || null;
  const clickIdType = input.clickIdType?.trim().toLowerCase() || null;
  const srcIsSocial = !!source && SOCIAL_SOURCE_NAMES.has(source);
  const srcIsSearch = !!source && SEARCH_SOURCE_NAMES.has(source);

  // 1. UTM medium is the strongest signal.
  if (medium) {
    if (EMAIL_MEDIUM.test(medium)) return { channel: "email", source, medium };
    if (medium === "whatsapp" || source === "whatsapp") return { channel: "whatsapp", source, medium };
    if (PAID_MEDIUM.test(medium)) {
      const social = srcIsSocial || medium.includes("social") || (clickIdType ? PAID_SOCIAL_CLICK_IDS.has(clickIdType) || clickIdType === "fbclid" : false);
      return { channel: social ? "social_paid" : "paid_search", source, medium };
    }
    if (SOCIAL_MEDIUM.test(medium)) return { channel: "social_organic", source, medium };
    if (medium === "organic") {
      return { channel: srcIsSocial ? "social_organic" : srcIsSearch || !source ? "organic_search" : "referral", source, medium };
    }
    if (medium === "referral") return { channel: "referral", source, medium };
  }

  // 2. Ad click ids.
  if (clickIdType && PAID_SEARCH_CLICK_IDS.has(clickIdType)) {
    return { channel: "paid_search", source: source ?? (clickIdType === "msclkid" ? "bing" : "google"), medium: medium ?? "cpc" };
  }
  if (clickIdType && PAID_SOCIAL_CLICK_IDS.has(clickIdType)) {
    const platform = clickIdType === "li_fat_id" ? "linkedin" : clickIdType === "ttclid" ? "tiktok" : "x";
    return { channel: "social_paid", source: source ?? platform, medium: medium ?? "paid" };
  }

  // 3. UTM source without a recognised medium.
  if (source) {
    if (source === "whatsapp") return { channel: "whatsapp", source, medium };
    if (srcIsSocial) return { channel: campaign && !medium ? "social_paid" : "social_organic", source, medium };
    if (srcIsSearch) return { channel: "organic_search", source, medium };
    if (EMAIL_SOURCE_NAMES.has(source)) return { channel: "email", source, medium };
    if (source !== "direct") return { channel: "referral", source, medium };
  }

  // fbclid is appended to every outbound Facebook/Instagram link, paid or not.
  if (clickIdType === "fbclid") return { channel: "social_organic", source: "facebook", medium };

  // 4. Referrer host.
  const refHost = hostOf(input.referrer);
  const landingHost = hostOf(input.landingUrl);
  if (refHost && refHost !== landingHost) {
    // Webmail first: mail.google.com would otherwise match the Google search rule.
    if (EMAIL_HOSTS.test(refHost)) return { channel: "email", source: refHost, medium: "email" };
    const search = match(SEARCH_ENGINES, refHost);
    if (search) return { channel: "organic_search", source: search, medium: "organic" };
    const social = match(SOCIAL_NETWORKS, refHost);
    if (social) return { channel: "social_organic", source: social, medium: "social" };
    if (WHATSAPP_HOSTS.test(refHost)) return { channel: "whatsapp", source: "whatsapp", medium: null };
    return { channel: "referral", source: refHost, medium: "referral" };
  }

  return { channel: "direct", source: null, medium: null };
}

// ─── Wire format from the widget ───────────────────────────────────────

const str = (max: number) => z.string().trim().max(max).optional().nullable();

/** One touch as captured in the browser (first-touch or current session). */
export const touchInputSchema = z.object({
  sessionId: str(100), // browser-session id: one "visit" per value
  source: str(200),
  medium: str(200),
  campaign: str(200),
  term: str(200),
  content: str(200),
  clickId: str(500),
  clickIdType: z.enum(CLICK_ID_TYPES).optional().nullable(),
  referrer: str(2000),
  landingUrl: str(2000),
  at: z.coerce.date().optional().nullable(),
});
export type TouchInput = z.infer<typeof touchInputSchema>;

/** `attribution` object the widget sends with chat/lead/track calls. */
export const attributionSchema = z.object({
  first: touchInputSchema.optional().nullable(),
  last: touchInputSchema.optional().nullable(),
});
export type AttributionInput = z.infer<typeof attributionSchema>;

/** Parse untrusted attribution; never throws (bad attribution must not block a lead). */
export function parseAttribution(raw: unknown): AttributionInput | null {
  if (raw == null) return null;
  const r = attributionSchema.safeParse(raw);
  return r.success && (r.data.first || r.data.last) ? r.data : null;
}

/** Map a channel to the Lead.source value shown in the CRM. */
export function leadSourceFromChannel(channel: Channel | null | undefined, fallback = "chatbot"): string {
  return channel ?? fallback;
}

// ─── DB writers ────────────────────────────────────────────────────────

type Tx = PrismaClient | Prisma.TransactionClient;

export interface RecordTouchArgs {
  businessId: string;
  kind: TouchKind;
  touch?: TouchInput | null;
  visitorId?: string | null;
  contactId?: string | null;
  /** Explicit channel (e.g. "whatsapp" for an inbound WhatsApp message); otherwise classified. */
  channel?: Channel;
  /** Idempotency key; a second insert with the same key returns the existing row. */
  dedupeKey?: string | null;
  occurredAt?: Date;
  /**
   * The campaign this touch belongs to (Phase 4 AA). Pass an id when the
   * touch came through a campaign's form, booking type or link; null for
   * none. Left undefined, recordTouch matches utm_campaign to a campaign.
   */
  campaignId?: string | null;
}

export function touchData(args: RecordTouchArgs): Prisma.TouchpointUncheckedCreateInput {
  const t = args.touch ?? {};
  const classified = classifyChannel({
    source: t.source,
    medium: t.medium,
    campaign: t.campaign,
    clickIdType: t.clickIdType,
    referrer: t.referrer,
    landingUrl: t.landingUrl,
  });
  const at = args.occurredAt ?? (t.at && !Number.isNaN(t.at.getTime()) && t.at.getTime() <= Date.now() ? t.at : new Date());
  return {
    businessId: args.businessId,
    contactId: args.contactId ?? null,
    visitorId: args.visitorId ?? null,
    kind: args.kind,
    channel: args.channel ?? classified.channel,
    source: classified.source,
    medium: classified.medium,
    campaign: t.campaign || null,
    term: t.term || null,
    content: t.content || null,
    clickId: t.clickId || null,
    clickIdType: t.clickId ? t.clickIdType ?? null : null,
    landingUrl: stripUrl(t.landingUrl),
    referrer: stripUrl(t.referrer),
    dedupeKey: args.dedupeKey ?? null,
    campaignId: args.campaignId ?? null,
    occurredAt: at,
  };
}

/** Insert a touchpoint, returning the existing one when `dedupeKey` was already used. */
export async function recordTouch(args: RecordTouchArgs, client: Tx = db) {
  const data = touchData(args);
  if (args.campaignId === undefined && data.campaign) {
    const { resolveCampaignId } = await import("@/lib/campaigns/service");
    data.campaignId = await resolveCampaignId(args.businessId, { utmCampaign: data.campaign, at: data.occurredAt as Date });
  }
  try {
    return await client.touchpoint.create({ data });
  } catch (e: unknown) {
    if (data.dedupeKey && (e as { code?: string })?.code === "P2002") {
      const existing = await client.touchpoint.findUnique({ where: { dedupeKey: data.dedupeKey } });
      if (existing) return existing;
    }
    throw e;
  }
}

/** Dedupe key for "one visit per visitor per browser session". */
export function visitDedupeKey(businessId: string, visitorId: string, sessionId: string): string {
  return `visit:${businessId}:${visitorId}:${sessionId}`.slice(0, 191);
}

/**
 * Record the visit(s) an attribution payload describes: the first-touch
 * session and the current session (often the same). Idempotent per browser
 * session, so the widget can resend the same payload with every call.
 */
export async function recordVisits(
  args: { businessId: string; visitorId: string; attribution: AttributionInput; contactId?: string | null },
  client: Tx = db
) {
  const out: Awaited<ReturnType<typeof recordTouch>>[] = [];
  const seen = new Set<string>();
  for (const touch of [args.attribution.first, args.attribution.last]) {
    if (!touch?.sessionId || seen.has(touch.sessionId)) continue;
    seen.add(touch.sessionId);
    out.push(
      await recordTouch(
        {
          businessId: args.businessId,
          kind: "visit",
          touch,
          visitorId: args.visitorId,
          contactId: args.contactId,
          dedupeKey: visitDedupeKey(args.businessId, args.visitorId, touch.sessionId),
        },
        client
      )
    );
  }
  return out;
}
