import type { MetadataRoute } from "next";
import { getCmsSite } from "@/lib/cms";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getCmsSite();
  const base = site?.domain ? `https://${site.domain}` : "https://danets-ai.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/app", "/platform", "/login", "/signup"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}