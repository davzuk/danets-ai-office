/**
 * CMS data access for the public marketing site.
 *
 * All read helpers are cached via `unstable_cache` at module scope (NOT
 * inside the function body — recreating the callback per call would defeat
 * the cache key). They are tagged so revalidation can flush either the
 * whole site ("cms") or a specific bucket ("cms:pages", "cms:posts", etc.).
 */

import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

export type CmsSiteSettings = {
  id: string;
  domain: string | null;
  brandName: string;
  tagline: string | null;
  description: string | null;
  supportEmail: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  socialLinks: Record<string, string> | null;
  seoDefaults: { title?: string; description?: string; ogImage?: string } | null;
};

export type CmsNavItem = {
  id: string;
  parentId: string | null;
  label: string;
  href: string;
  order: number;
  visible: boolean;
  icon: string | null;
};

export type CmsBlockDef = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  schema: unknown;
  defaultProps: Record<string, unknown>;
  icon: string | null;
};

export type CmsPageBlock = {
  /** Either an existing block key (e.g. "hero") or a one-off id. */
  blockKey: string;
  props: Record<string, unknown>;
};

export type CmsPageRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  ogImage: string | null;
  status: string;
  publishedAt: string | null;
  blocks: CmsPageBlock[];
  seo: Record<string, unknown> | null;
};

export type CmsPostRecord = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  bodyMdx: string;
  status: string;
  publishedAt: string | null;
  seo: Record<string, unknown> | null;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  tags: { id: string; slug: string; name: string }[];
};

const CACHE_OPTS = { revalidate: 60 } as const;
const TAGS_ALL = ["cms"] as const;

// ─── Site settings ────────────────────────────────────────────────

const _getCmsSite = unstable_cache(
  async (): Promise<CmsSiteSettings | null> => {
    const row = await db.cmsSite.findFirst({ orderBy: { createdAt: "asc" } });
    if (!row) return null;
    return {
      id: row.id,
      domain: row.domain,
      brandName: row.brandName,
      tagline: row.tagline,
      description: row.description,
      supportEmail: row.supportEmail,
      logoUrl: row.logoUrl,
      faviconUrl: row.faviconUrl,
      primaryColor: row.primaryColor,
      accentColor: row.accentColor,
      socialLinks: (row.socialLinks as Record<string, string> | null) ?? null,
      seoDefaults:
        (row.seoDefaults as CmsSiteSettings["seoDefaults"] | null) ?? null,
    };
  },
  ["cms:site"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:site"] }
);

export function getCmsSite(): Promise<CmsSiteSettings | null> {
  return _getCmsSite();
}

// ─── Nav ──────────────────────────────────────────────────────────

const _getCmsNavItems = unstable_cache(
  async (): Promise<CmsNavItem[]> => {
    const items = await db.cmsNavItem.findMany({
      where: { visible: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return items.map((i) => ({
      id: i.id,
      parentId: i.parentId,
      label: i.label,
      href: i.href,
      order: i.order,
      visible: i.visible,
      icon: i.icon,
    }));
  },
  ["cms:nav"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:nav"] }
);

export function getCmsNavItems(): Promise<CmsNavItem[]> {
  return _getCmsNavItems();
}

// ─── Block library ────────────────────────────────────────────────

const _getCmsBlockDefs = unstable_cache(
  async (): Promise<CmsBlockDef[]> => {
    const blocks = await db.cmsBlock.findMany({
      where: { isActive: true },
      orderBy: { label: "asc" },
    });
    return blocks.map((b) => ({
      id: b.id,
      key: b.key,
      label: b.label,
      description: b.description,
      schema: b.schema,
      defaultProps: (b.defaultProps as Record<string, unknown> | null) ?? {},
      icon: b.icon,
    }));
  },
  ["cms:blocks"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:blocks"] }
);

export function getCmsBlockDefs(): Promise<CmsBlockDef[]> {
  return _getCmsBlockDefs();
}

// ─── Pages ────────────────────────────────────────────────────────

const _getCmsPageBySlug = unstable_cache(
  async (slug: string): Promise<CmsPageRecord | null> => {
    const row = await db.cmsPage.findUnique({ where: { slug } });
    if (!row || row.status !== "published") return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      ogImage: row.ogImage,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      blocks: parseBlocks(row.blocks),
      seo: (row.seo as Record<string, unknown> | null) ?? null,
    };
  },
  ["cms:page-by-slug"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:pages"] }
);

/**
 * Fetches a published CMS page by slug. Returns null if no published
 * page exists at that slug so the route can render a fallback.
 */
export function getCmsPageBySlug(
  slug: string
): Promise<CmsPageRecord | null> {
  return _getCmsPageBySlug(slug);
}

const _listCmsPageSlugs = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await db.cmsPage.findMany({
      where: { status: "published" },
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  },
  ["cms:page-slugs"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:pages"] }
);

export function listCmsPageSlugs(): Promise<string[]> {
  return _listCmsPageSlugs();
}

// ─── Posts ────────────────────────────────────────────────────────

const _listPublishedPosts = unstable_cache(
  async (limit: number, tag: string | undefined) => {
    const rows = await db.cmsPost.findMany({
      where: {
        status: "published",
        ...(tag ? { tags: { some: { slug: tag } } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: limit,
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        tags: { select: { id: true, slug: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      coverImage: r.coverImage,
      bodyMdx: r.bodyMdx,
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      seo: (r.seo as Record<string, unknown> | null) ?? null,
      author: r.author
        ? { id: r.author.id, name: r.author.name, avatarUrl: r.author.avatarUrl }
        : null,
      tags: r.tags,
    }));
  },
  ["cms:posts"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:posts"] }
);

export function listPublishedPosts(opts?: {
  limit?: number;
  tag?: string;
}): Promise<CmsPostRecord[]> {
  return _listPublishedPosts(opts?.limit ?? 50, opts?.tag);
}

const _getCmsPostBySlug = unstable_cache(
  async (slug: string): Promise<CmsPostRecord | null> => {
    const row = await db.cmsPost.findUnique({
      where: { slug },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        tags: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!row || row.status !== "published") return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      coverImage: row.coverImage,
      bodyMdx: row.bodyMdx,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      seo: (row.seo as Record<string, unknown> | null) ?? null,
      author: row.author
        ? { id: row.author.id, name: row.author.name, avatarUrl: row.author.avatarUrl }
        : null,
      tags: row.tags,
    };
  },
  ["cms:post-by-slug"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:posts"] }
);

export function getCmsPostBySlug(
  slug: string
): Promise<CmsPostRecord | null> {
  return _getCmsPostBySlug(slug);
}

/**
 * Find the previous / next published post relative to `slug`, ordered by
 * `publishedAt desc`. Used to render prev/next navigation at the bottom
 * of every blog post. Both results can be null — e.g. on the newest
 * post there's no "next" and on the oldest there's no "prev".
 */
const _getCmsPostNeighbors = unstable_cache(
  async (slug: string): Promise<{ prev: CmsPostRecord | null; next: CmsPostRecord | null }> => {
    const current = await db.cmsPost.findUnique({
      where: { slug },
      select: { id: true, publishedAt: true, status: true },
    });
    if (!current || current.status !== "published" || !current.publishedAt) {
      return { prev: null, next: null };
    }
    const [prev, next] = await Promise.all([
      // "prev" = newer post (smaller date)
      db.cmsPost.findFirst({
        where: {
          status: "published",
          publishedAt: { gt: current.publishedAt },
        },
        orderBy: { publishedAt: "asc" },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          tags: { select: { id: true, slug: true, name: true } },
        },
      }),
      // "next" = older post (larger date)
      db.cmsPost.findFirst({
        where: {
          status: "published",
          publishedAt: { lt: current.publishedAt },
        },
        orderBy: { publishedAt: "desc" },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          tags: { select: { id: true, slug: true, name: true } },
        },
      }),
    ]);
    const map = (r: typeof prev): CmsPostRecord | null =>
      r
        ? {
            id: r.id,
            slug: r.slug,
            title: r.title,
            excerpt: r.excerpt,
            coverImage: r.coverImage,
            bodyMdx: r.bodyMdx,
            status: r.status,
            publishedAt: r.publishedAt?.toISOString() ?? null,
            seo: (r.seo as Record<string, unknown> | null) ?? null,
            author: r.author
              ? { id: r.author.id, name: r.author.name, avatarUrl: r.author.avatarUrl }
              : null,
            tags: r.tags,
          }
        : null;
    return { prev: map(prev), next: map(next) };
  },
  ["cms:post-neighbors"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:posts"] }
);

export function getCmsPostNeighbors(
  slug: string
): Promise<{ prev: CmsPostRecord | null; next: CmsPostRecord | null }> {
  return _getCmsPostNeighbors(slug);
}

// ─── Changelog ────────────────────────────────────────────────────

const _listCmsChangelog = unstable_cache(
  async (limit: number) => {
    const rows = await db.cmsChangelogEntry.findMany({
      orderBy: { publishedAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      title: r.title,
      body: r.body,
      kind: r.kind,
      publishedAt: r.publishedAt.toISOString(),
    }));
  },
  ["cms:changelog"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:changelog"] }
);

export function listCmsChangelog(limit = 20) {
  return _listCmsChangelog(limit);
}

// ─── Marketing plans ──────────────────────────────────────────────

export type MarketingPlan = {
  name: string;
  priceUsd: number;
  chatLimit: number;
  leadLimit: number;
  features: string[];
  isActive: boolean;
};

const _listMarketingPlans = unstable_cache(
  async (): Promise<MarketingPlan[]> => {
    const rows = await db.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceUsd: "asc" },
    });
    return rows.map((r) => ({
      name: r.name,
      priceUsd: r.priceUsd,
      chatLimit: r.chatLimit,
      leadLimit: r.leadLimit,
      features: safeJsonArray(r.features),
      isActive: r.isActive,
    }));
  },
  ["cms:plans"],
  { ...CACHE_OPTS, tags: [...TAGS_ALL, "cms:plans"] }
);

/** Active plans for the public pricing table, sorted free → enterprise. */
export function listMarketingPlans(): Promise<MarketingPlan[]> {
  return _listMarketingPlans();
}

// ─── Helpers ──────────────────────────────────────────────────────

function safeJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function parseBlocks(raw: unknown): CmsPageBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const blockKey = typeof e.blockKey === "string" ? e.blockKey : null;
      if (!blockKey) return null;
      const props =
        e.props && typeof e.props === "object"
          ? (e.props as Record<string, unknown>)
          : {};
      return { blockKey, props };
    })
    .filter((b): b is CmsPageBlock => b !== null);
}