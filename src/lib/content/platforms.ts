// Per-platform rules for social copy. Pure (no server imports) so the Studio
// can show the same counts and warnings the server enforces.

export const CONTENT_PLATFORMS = ["facebook", "instagram", "linkedin", "x", "tiktok"] as const;
export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

export const CONTENT_GOALS = ["awareness", "engagement", "leads", "promotion"] as const;
export type ContentGoal = (typeof CONTENT_GOALS)[number];

export interface PlatformRule {
  label: string;
  /** Hard limit on the composed text (body + hashtags, + link where it's inline). */
  maxChars: number;
  /** Where engagement drops off; past this is a warning, not an error. */
  idealChars: number;
  maxHashtags: number;
  idealHashtags: [number, number];
  /** Links in the text are clickable. Instagram and TikTok captions aren't. */
  clickableLinks: boolean;
  /** The link goes inside the text (X) rather than as a separate link field. */
  linkInline: boolean;
  /** Published through an API in K; the rest are copy-and-post. */
  autoPublish: boolean;
  /** Guidance given to the model. */
  style: string;
}

export const PLATFORM_RULES: Record<ContentPlatform, PlatformRule> = {
  facebook: {
    label: "Facebook",
    maxChars: 63_206,
    idealChars: 500,
    maxHashtags: 10,
    idealHashtags: [0, 3],
    clickableLinks: true,
    linkInline: false,
    autoPublish: true,
    style:
      "Conversational, 1–3 short paragraphs. Open with a hook in the first line (only ~125 characters show before 'See more'). 0–3 hashtags at most. If there is a link it is attached separately; don't paste it into the body.",
  },
  instagram: {
    label: "Instagram",
    maxChars: 2_200,
    idealChars: 1_000,
    maxHashtags: 30,
    idealHashtags: [3, 8],
    clickableLinks: false,
    linkInline: false,
    autoPublish: true,
    style:
      "Visual-first caption: strong first line, short lines with line breaks, emoji only if the brand allows them. Links are NOT clickable: never put a URL in the caption; say 'link in bio' instead. 3–8 relevant hashtags, returned in the hashtags field, never more than 30.",
  },
  linkedin: {
    label: "LinkedIn",
    maxChars: 3_000,
    idealChars: 1_300,
    maxHashtags: 10,
    idealHashtags: [1, 5],
    clickableLinks: true,
    linkInline: false,
    autoPublish: true,
    style:
      "Professional and insight-led. Hook in the first two lines (about 210 characters show before 'see more'), short paragraphs separated by blank lines, a clear takeaway or question at the end. 1–5 hashtags. Attach links separately; don't paste them into the body.",
  },
  x: {
    label: "X",
    maxChars: 280,
    idealChars: 240,
    maxHashtags: 3,
    idealHashtags: [0, 2],
    clickableLinks: true,
    linkInline: true,
    autoPublish: false,
    style:
      "One punchy post of at most 280 characters INCLUDING hashtags and the link (a link always counts as 23 characters). 0–2 hashtags. No threads.",
  },
  tiktok: {
    label: "TikTok",
    maxChars: 2_200,
    idealChars: 300,
    maxHashtags: 10,
    idealHashtags: [3, 6],
    clickableLinks: false,
    linkInline: false,
    autoPublish: false,
    style:
      "A short caption for a video: a hook, one or two lines of context and a call to action. Links aren't clickable: say 'link in bio'. 3–6 hashtags. Put the video idea in imagePrompt (what to film, in a sentence or two).",
  },
};

export function isContentPlatform(p: unknown): p is ContentPlatform {
  return typeof p === "string" && (CONTENT_PLATFORMS as readonly string[]).includes(p);
}

const URL_RE = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+\.[a-z]{2,}[^\s]*/gi;
const HAS_URL = new RegExp(URL_RE.source, "i");

/** Clean model or user hashtags: no '#', no spaces or punctuation, de-duplicated (case-insensitively). */
export function normalizeHashtags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const clean = t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 60);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

export interface VariantContent {
  body: string;
  hashtags: string[];
  linkUrl?: string | null;
}

/** The text exactly as it would be posted. */
export function composeText(platform: ContentPlatform, v: VariantContent): string {
  const rule = PLATFORM_RULES[platform];
  const parts = [v.body.trim()];
  if (rule.linkInline && v.linkUrl) parts.push(v.linkUrl.trim());
  const tags = normalizeHashtags(v.hashtags);
  if (tags.length) parts.push(tags.map((t) => `#${t}`).join(" "));
  return parts.filter(Boolean).join("\n\n");
}

/**
 * X counts most Latin text as 1 per character, CJK and emoji as 2, and every
 * URL as 23 (twitter-text v3 weighting, simplified).
 */
export function xWeightedLength(text: string): number {
  let n = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** Length the way the platform counts it. */
export function platformLength(platform: ContentPlatform, text: string): number {
  return platform === "x" ? xWeightedLength(text) : [...text].length;
}

export interface VariantIssue {
  severity: "error" | "warning";
  code: "too_long" | "too_many_hashtags" | "link_not_clickable" | "empty" | "long" | "hashtags_outside_norm" | "banned_phrase";
  message: string;
}

/** Check a variant against its platform's rules. Errors must be fixed before approval. */
export function checkVariant(platform: ContentPlatform, v: VariantContent, bannedPhrases: string[] = []): VariantIssue[] {
  const rule = PLATFORM_RULES[platform];
  const issues: VariantIssue[] = [];
  const text = composeText(platform, v);
  const len = platformLength(platform, text);
  const tags = normalizeHashtags(v.hashtags);

  if (!v.body.trim()) issues.push({ severity: "error", code: "empty", message: "The post is empty." });
  if (len > rule.maxChars) {
    issues.push({ severity: "error", code: "too_long", message: `${len.toLocaleString()} of ${rule.maxChars.toLocaleString()} characters: shorten it by ${(len - rule.maxChars).toLocaleString()}.` });
  } else if (len > rule.idealChars) {
    issues.push({ severity: "warning", code: "long", message: `Longer than the ~${rule.idealChars.toLocaleString()} characters that usually perform best on ${rule.label}.` });
  }
  if (tags.length > rule.maxHashtags) {
    issues.push({ severity: "error", code: "too_many_hashtags", message: `${tags.length} hashtags: ${rule.label} allows ${rule.maxHashtags}.` });
  } else if (tags.length < rule.idealHashtags[0] || tags.length > rule.idealHashtags[1]) {
    issues.push({ severity: "warning", code: "hashtags_outside_norm", message: `${rule.label} posts usually do best with ${rule.idealHashtags[0]}–${rule.idealHashtags[1]} hashtags.` });
  }
  if (!rule.clickableLinks && HAS_URL.test(v.body)) {
    issues.push({ severity: "error", code: "link_not_clickable", message: `Links aren't clickable on ${rule.label}. Use "link in bio" instead.` });
  }
  for (const phrase of findBannedPhrases(text, bannedPhrases)) {
    issues.push({ severity: "error", code: "banned_phrase", message: `Uses "${phrase}", which the brand voice says never to say.` });
  }
  return issues;
}

export const hasErrors = (issues: VariantIssue[]) => issues.some((i) => i.severity === "error");

// ─── Banned phrases ────────────────────────────────────────────────────

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function phraseRegex(phrase: string): RegExp | null {
  const p = fold(phrase).trim();
  if (p.length < 2) return null;
  // Whole-word at the edges that are word characters ("free" shouldn't match "freedom").
  const start = /^[\p{L}\p{N}]/u.test(p) ? "(?<![\\p{L}\\p{N}])" : "";
  const end = /[\p{L}\p{N}]$/u.test(p) ? "(?![\\p{L}\\p{N}])" : "";
  // Hashtags drop spaces, so "best in town" also matches #bestintown.
  const body = p.split(" ").map(escapeRe).join("[\\s#_-]*");
  return new RegExp(`${start}${body}${end}`, "u");
}

/** The brand's "never say" phrases that appear in the text (case, accent and spacing-insensitive). */
export function findBannedPhrases(text: string, phrases: string[]): string[] {
  const t = fold(text);
  return phrases.filter((ph) => phraseRegex(ph)?.test(t));
}

/**
 * Last-resort scrub after the model has been asked to fix a violation and
 * didn't: drop the sentences and hashtags that contain banned phrases.
 */
export function scrubBannedPhrases(v: VariantContent, phrases: string[]): VariantContent {
  if (!phrases.length) return v;
  const res = phrases.map(phraseRegex).filter((r): r is RegExp => !!r);
  const bad = (s: string) => res.some((r) => r.test(fold(s)));
  const body = v.body
    .split("\n")
    .map((line) =>
      bad(line)
        ? (line.match(/[^.!?]+[.!?]*\s*/g) ?? [line]).filter((sentence) => !bad(sentence)).join("").trim()
        : line
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...v, body, hashtags: normalizeHashtags(v.hashtags).filter((t) => !bad(t)) };
}
