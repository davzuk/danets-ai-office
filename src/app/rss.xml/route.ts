import { listPublishedPosts, getCmsSite } from "@/lib/cms";

export const revalidate = 3600;

function escape(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const [site, posts] = await Promise.all([
    getCmsSite(),
    listPublishedPosts({ limit: 30 }),
  ]);
  const base = site?.domain ? `https://${site.domain}` : "https://danets-ai.com";
  const title = site?.brandName ?? "Danets AI Automation";

  const items = posts
    .map((p) => {
      const link = `${base}/blog/${p.slug}`;
      const pub = p.publishedAt
        ? new Date(p.publishedAt).toUTCString()
        : new Date().toUTCString();
      return `    <item>
      <title>${escape(p.title)}</title>
      <link>${escape(link)}</link>
      <guid>${escape(link)}</guid>
      <pubDate>${pub}</pubDate>
      ${p.excerpt ? `<description>${escape(p.excerpt)}</description>` : ""}
      ${p.author ? `<dc:creator>${escape(p.author.name)}</dc:creator>` : ""}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escape(title)} Blog</title>
    <link>${escape(base)}/blog</link>
    <description>Product news, AI insights and engineering posts from the Danets TecPro team.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
