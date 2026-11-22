import "server-only";
// Tenant site data for the public renderer and the dashboard.

import { cache } from "react";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isModuleEnabled } from "@/lib/module-access";
import { logger, serializeError } from "@/lib/logger";
import { appOrigin } from "@/lib/public-cors";
import { customDomainOrigin, siteOrigin } from "./host";
import { pageSeoSchema, readBlocks, siteSeoDefaultsSchema, siteThemeSchema, validateBlocks, type PageSeo, type ParsedBlock, type SiteSeoDefaults, type SiteTheme } from "./blocks";

export interface RenderSite {
  id: string;
  businessId: string;
  subdomain: string;
  /** The canonical origin: the verified custom domain when there is one, else the subdomain. */
  origin: string;
  /** Set when a verified custom domain is the canonical address. */
  customOrigin: string | null;
  /** Which address this request came in on. */
  servedOn: "subdomain" | "domain";
  name: string;
  publicKey: string;
  theme: SiteTheme | null;
  seoDefaults: SiteSeoDefaults | null;
  widgetEnabled: boolean;
  business: { phone: string | null; email: string | null; whatsapp: string | null; industry: string | null };
}

export const readTheme = (v: unknown): SiteTheme | null => {
  const r = siteThemeSchema.safeParse(v ?? {});
  return r.success ? r.data : null;
};
export const readSeoDefaults = (v: unknown): SiteSeoDefaults | null => {
  const r = siteSeoDefaultsSchema.safeParse(v ?? {});
  return r.success ? r.data : null;
};
export const readPageSeo = (v: unknown): PageSeo => {
  const r = pageSeoSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
};

/**
 * The site a tenant host serves, or null when it shouldn't be served: no
 * such site, suspended by a platform admin, the business isn't active, or
 * its plan no longer includes the Website module. `key` is a subdomain, or
 * a whole hostname for a custom domain, which must be verified and on a
 * plan with custom domains.
 */
export const getRenderSite = cache(async (key: string): Promise<RenderSite | null> => {
  const byDomain = key.includes(".");
  const site = await db.tenantSite.findUnique({
    where: byDomain ? { customDomain: key } : { subdomain: key },
    include: {
      business: {
        select: { id: true, name: true, publicKey: true, status: true, plan: true, phone: true, email: true, whatsapp: true, industry: true },
      },
    },
  });
  if (!site || site.status !== "active" || site.business.status !== "active") return null;
  if (!(await isModuleEnabled(site.businessId, "sites", site.business.plan))) return null;
  const domainLive = site.domainStatus === "verified" && !!site.customDomain && (await isModuleEnabled(site.businessId, "sites_domain", site.business.plan));
  if (byDomain && !domainLive) return null;
  const subOrigin = siteOrigin(site.subdomain);
  const customOrigin = domainLive ? customDomainOrigin(site.customDomain!) : null;
  const origin = customOrigin ?? subOrigin;
  if (!origin) return null;
  const b = site.business;
  return {
    id: site.id,
    businessId: site.businessId,
    subdomain: site.subdomain,
    origin,
    customOrigin,
    servedOn: byDomain ? "domain" : "subdomain",
    name: b.name,
    publicKey: b.publicKey,
    theme: readTheme(site.theme),
    seoDefaults: readSeoDefaults(site.seoDefaults),
    widgetEnabled: site.widgetEnabled,
    business: { phone: b.phone, email: b.email, whatsapp: b.whatsapp, industry: b.industry },
  };
});

export interface RenderPage {
  id: string;
  slug: string;
  title: string;
  blocks: ParsedBlock[];
  seo: PageSeo;
  publishedAt: Date | null;
}

export const getPublishedPage = cache(async (siteId: string, slug: string): Promise<RenderPage | null> => {
  const page = await db.landingPage.findUnique({ where: { siteId_slug: { siteId, slug } } });
  if (!page || page.status !== "published" || !page.publishedBlocks) return null;
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    // Published blocks were valid when published; anything that no longer
    // parses (a schema change) is skipped rather than breaking the page.
    blocks: validateBlocks(readBlocks(page.publishedBlocks)).blocks,
    seo: readPageSeo(page.seo),
    publishedAt: page.publishedAt,
  };
});

/** Links in the site header: published pages other than the home page. */
export const getSiteNav = cache(async (siteId: string) => {
  const pages = await db.landingPage.findMany({
    where: { siteId, status: "published", NOT: { slug: "" } },
    select: { slug: true, title: true, seo: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return pages
    .filter((p) => !readPageSeo(p.seo).hideFromNav)
    .slice(0, 6)
    .map((p) => ({ label: p.title, href: `/${p.slug}` }));
});

export async function listPublishedSlugs(siteId: string) {
  return db.landingPage.findMany({
    where: { siteId, status: "published" },
    select: { slug: true, seo: true, publishedAt: true, updatedAt: true },
    orderBy: { slug: "asc" },
    take: 1000,
  });
}

// ─── Views ─────────────────────────────────────────────────────────

const seen = new Map<string, number>();
const DAY = 86_400_000;

/**
 * Count a page view, once per visitor (IP + user agent) per page per day.
 * The dedupe set is per server process; with several app servers a visitor
 * may count once on each, which is close enough for a page counter.
 * Attribution (which page brought a lead) comes from the chat widget's
 * visit touchpoints, not from this counter.
 */
export async function recordPageView(pageId: string, ip: string | null, userAgent: string | null, now = Date.now()): Promise<boolean> {
  if (userAgent && /bot|crawler|spider|preview|facebookexternalhit|slurp|lighthouse/i.test(userAgent)) return false;
  const day = Math.floor(now / DAY);
  const key = createHash("sha256").update(`${pageId}|${ip ?? ""}|${userAgent ?? ""}|${day}`).digest("base64url").slice(0, 22);
  if (seen.has(key)) return false;
  seen.set(key, now);
  if (seen.size > 50_000) {
    for (const [k, t] of seen) if (now - t > DAY) seen.delete(k);
    if (seen.size > 50_000) seen.clear();
  }
  try {
    await db.landingPage.update({ where: { id: pageId }, data: { views: { increment: 1 } } });
    return true;
  } catch (e) {
    logger.warn("page view not counted", { pageId, ...serializeError(e) });
    return false;
  }
}

/** Page URL as touchpoints store it: origin + path, no trailing slash except the home page. */
export const pageUrl = (origin: string, slug: string) => (slug ? `${origin}/${slug}` : `${origin}/`);

/**
 * Leads whose first touch landed on each page (the widget records the
 * landing URL with every visit touchpoint).
 */
export async function pageConversions(businessId: string, origins: string | string[], slugs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const list = (Array.isArray(origins) ? origins : [origins]).filter(Boolean);
  if (!slugs.length || !list.length) return out;
  const urls = new Map<string, string>();
  for (const origin of list) {
    for (const slug of slugs) {
      const u = pageUrl(origin, slug);
      urls.set(u, slug);
      if (slug) urls.set(`${u}/`, slug);
      else urls.set(origin, slug);
    }
  }
  const rows = await db.$queryRaw<{ landingUrl: string; n: bigint }[]>`
    SELECT t.landingUrl AS landingUrl, COUNT(*) AS n
    FROM \`Lead\` l JOIN \`Touchpoint\` t ON t.id = l.firstTouchId
    WHERE l.businessId = ${businessId} AND t.landingUrl IN (${Prisma.join([...urls.keys()])})
    GROUP BY t.landingUrl`;
  for (const r of rows) {
    const slug = urls.get(r.landingUrl);
    if (slug !== undefined) out.set(slug, (out.get(slug) ?? 0) + Number(r.n));
  }
  return out;
}

export { appOrigin };
