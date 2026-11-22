// UTM tags for links in published posts (Phase 1 M). Visits that land through
// a tagged link are recorded as touchpoints by the widget (src/lib/attribution.ts),
// so a lead who later converts is counted toward the post: utm_content carries
// the ScheduledPost id.

/** Platform name used as utm_source, matching attribution's social source names. */
const UTM_SOURCE: Record<string, string> = {
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  x: "x",
  tiktok: "tiktok",
};

/** "Spring Sale 2026!" → "spring-sale-2026". */
export function campaignSlug(tag: string): string {
  return tag
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface UtmInput {
  platform: string;
  scheduledPostId: string;
  postId: string;
  campaignTag?: string | null;
}

export function utmParams(input: UtmInput): Record<string, string> {
  const slug = input.campaignTag ? campaignSlug(input.campaignTag) : "";
  return {
    utm_source: UTM_SOURCE[input.platform] ?? input.platform,
    utm_medium: "social",
    utm_campaign: slug || `post-${input.postId}`,
    utm_content: input.scheduledPostId,
  };
}

/**
 * Add UTM tags to an http(s) link. Tags the author already set are kept, and
 * anything that isn't a parseable web URL is returned unchanged.
 */
export function tagLink(url: string | null | undefined, input: UtmInput): string | null {
  if (!url) return url ?? null;
  const trimmed = url.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return url;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return url;
  for (const [k, v] of Object.entries(utmParams(input))) {
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  }
  return u.toString();
}
