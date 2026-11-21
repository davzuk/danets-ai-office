import { listCmsChangelog, getCmsSite } from "@/lib/cms";

export const revalidate = 3600;

function escape(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * GET /changelog/rss.xml — Atom/RSS feed of the public changelog entries.
 *
 * Distinct from /rss.xml (the blog feed) so subscribers can follow
 * product changes without getting engineering posts. Re-validated hourly.
 */
export async function GET() {
  const [site, entries] = await Promise.all([
    getCmsSite(),
    listCmsChangelog(50),
  ]);
  const base = site?.domain ? `https://${site.domain}` : "https://danets-ai.com";
  const title = site?.brandName ?? "Danets AI Automation";

  const items = entries
    .map((e) => {
      const link = `${base}/changelog#${e.id}`;
      const pub = new Date(e.publishedAt).toUTCString();
      return `    <item>
      <title>${escape(e.title)}</title>
      <link>${escape(link)}</link>
      <guid isPermaLink="false">${escape(e.id)}</guid>
      <pubDate>${pub}</pubDate>
      <category>${escape(e.kind)}</category>
      ${e.version ? `<category>${escape(e.version)}</category>` : ""}
      <description>${escape(e.body.slice(0, 280))}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escape(title)} — Changelog</title>
    <link>${escape(base)}/changelog</link>
    <description>Product releases, improvements and fixes shipped to ${escape(title)}.</description>
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