import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import {
  getCmsSite,
  listCmsPageSlugs,
  listPublishedPosts,
} from "@/lib/cms";

/**
 * Public sitemap. Built from CMS pages + blog posts. The platform
 * console, /login, /app and /api routes are explicitly excluded.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getCmsSite();
  const base = site?.domain ? `https://${site.domain}` : "https://danets-ai.com";

  const staticUrls: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/features`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/industries`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/blog`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/changelog`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/widget-demo`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const [pageSlugs, posts] = await Promise.all([
    listCmsPageSlugs(),
    listPublishedPosts({ limit: 200 }),
  ]);

  const cmsPages = pageSlugs
    .filter((s) => !["home", "pricing", "features", "about", "industries"].includes(s))
    .map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

  const blogPosts = posts.map((p) => ({
    url: `${base}/blog/${p.slug}`,
    lastModified: p.publishedAt ? new Date(p.publishedAt) : undefined,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticUrls, ...cmsPages, ...blogPosts];
}