// Campaign rules (Phase 4 AA). Pure: no DB, safe to import from client
// components and unit tests.
import { z } from "zod";
import { campaignSlug } from "@/lib/social/utm";

export { campaignSlug };

export const CAMPAIGN_GOALS = ["leads", "bookings", "sales", "awareness"] as const;
export type CampaignGoal = (typeof CAMPAIGN_GOALS)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended", "archived"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Statuses that count toward `campaignLimit`. */
export const COUNTED_STATUSES: CampaignStatus[] = ["draft", "active", "paused"];

/** Late clicks on an ended campaign's links still count for this long. */
export const ENDED_GRACE_DAYS = 30;

export const GOAL_LABELS: Record<CampaignGoal, string> = {
  leads: "Leads",
  bookings: "Bookings",
  sales: "Sales",
  awareness: "Awareness",
};

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  archived: "Archived",
};

/** Kinds of thing a campaign can link to. Landing pages are set by the platform only. */
export const ASSET_TYPES = ["post", "form", "magnet", "booking_type", "page"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const TENANT_ASSET_TYPES = ["post", "form", "magnet", "booking_type"] as const satisfies readonly AssetType[];

const MAX_ALIASES = 10;

/** Slugify and de-duplicate aliases, dropping the slug itself and empties. */
export function normalizeAliases(raw: unknown, slug: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const a of raw) {
    if (typeof a !== "string") continue;
    const s = campaignSlug(a);
    if (!s || s === slug || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

const dateish = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return d;
  });

const money = z
  .union([z.number(), z.string().trim(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999) {
      ctx.addIssue({ code: "custom", message: "Enter a budget of 0 or more." });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

const campaignFields = {
  name: z.string().trim().min(2, "Give the campaign a name.").max(160),
  slug: z.string().trim().max(80).optional(),
  goal: z.enum(CAMPAIGN_GOALS).optional(),
  startsAt: dateish,
  endsAt: dateish,
  budget: money,
  targetLeads: z.union([z.number().int().min(0).max(10_000_000), z.null()]).optional(),
  ownerId: z.string().max(64).nullish(),
  notes: z.string().max(5000).nullish(),
  aliases: z.array(z.string().max(120)).max(MAX_ALIASES * 2).optional(),
};

export const createCampaignSchema = z
  .object({ ...campaignFields, status: z.enum(["draft", "active"]).optional() })
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt >= c.startsAt, { message: "The end date must be after the start date.", path: ["endsAt"] });

export const updateCampaignSchema = z
  .object({ ...campaignFields, name: campaignFields.name.optional(), status: z.enum(CAMPAIGN_STATUSES).optional() })
  .refine((c) => !c.startsAt || !c.endsAt || c.endsAt >= c.startsAt, { message: "The end date must be after the start date.", path: ["endsAt"] });

export const assetLinkSchema = z.object({
  type: z.enum(ASSET_TYPES),
  id: z.string().min(1).max(64),
  /** false unlinks it (only if it is linked to this campaign). */
  linked: z.boolean().default(true),
});

/** What a touchpoint can be matched by. */
export interface MatchableCampaign {
  id: string;
  slug: string;
  aliases: string[];
  status: string;
  endedAt: Date | null;
}

/** Can new touches still be matched to this campaign by UTM? */
export function acceptsUtmMatches(c: Pick<MatchableCampaign, "status" | "endedAt">, now = new Date()): boolean {
  if (c.status === "archived") return false;
  if (c.status === "ended") {
    if (!c.endedAt) return false;
    return now.getTime() - c.endedAt.getTime() <= ENDED_GRACE_DAYS * 86_400_000;
  }
  return true;
}

/**
 * Index campaigns by every key a utm_campaign value may match: the slug
 * first, then aliases (a slug always wins over another campaign's alias).
 */
export function buildMatchIndex(campaigns: MatchableCampaign[], now = new Date()): Map<string, string> {
  const index = new Map<string, string>();
  const open = campaigns.filter((c) => acceptsUtmMatches(c, now));
  for (const c of open) index.set(c.slug, c.id);
  for (const c of open) {
    for (const a of c.aliases) if (!index.has(a)) index.set(a, c.id);
  }
  return index;
}

/** The campaign a raw utm_campaign (or ad campaign name) belongs to, if any. */
export function matchCampaign(index: Map<string, string>, utmCampaign: string | null | undefined): string | null {
  if (!utmCampaign) return null;
  const key = campaignSlug(utmCampaign);
  return (key && index.get(key)) || null;
}

/** A slug that's free among `taken`, adding -2, -3, … when needed. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = campaignSlug(base) || "campaign";
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const s = `${root.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(s)) return s;
  }
  return `${root.slice(0, 70)}-${Date.now().toString(36)}`;
}

/** Status change side effects: when it ended (for the UTM grace period). */
export function endedAtFor(next: string, prev: { status: string; endedAt: Date | null }, now = new Date()): Date | null {
  if (next !== "ended") return next === "archived" ? prev.endedAt : null;
  return prev.status === "ended" && prev.endedAt ? prev.endedAt : now;
}
