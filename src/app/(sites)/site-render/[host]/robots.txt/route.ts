import { getRenderSite } from "@/lib/sites/server";

export const dynamic = "force-dynamic";

// robots.txt for a tenant site (reached through the middleware rewrite).
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const site = await getRenderSite((await params).host);
  const body = site ? `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
