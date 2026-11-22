import { getRenderSite, listPublishedSlugs, pageUrl, readPageSeo } from "@/lib/sites/server";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// sitemap.xml for a tenant site: every published page that isn't noindex.
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const site = await getRenderSite((await params).host);
  if (!site) return new Response("Not found", { status: 404 });
  const pages = (await listPublishedSlugs(site.id)).filter((p) => !readPageSeo(p.seo).noindex);
  const urls = pages
    .map((p) => `  <url><loc>${esc(pageUrl(site.origin, p.slug))}</loc><lastmod>${(p.publishedAt ?? p.updatedAt).toISOString()}</lastmod></url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
