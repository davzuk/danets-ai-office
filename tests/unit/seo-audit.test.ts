import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ─── In-memory stand-in for the few tables the crawler touches ─────────

const mem = vi.hoisted(() => ({
  audits: new Map<string, Record<string, unknown>>(),
  issues: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
  widgetOrigins: [] as string[],
}));

vi.mock("@/lib/db", async () => {
  const { Prisma } = await import("@prisma/client");
  const clean = (v: unknown) => (v === Prisma.DbNull || v === Prisma.JsonNull ? null : v);
  let n = 0;
  return {
    db: {
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      siteAudit: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const a = mem.audits.get(where.id);
          return a ? JSON.parse(JSON.stringify(a)) : null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const a = mem.audits.get(where.id)!;
          for (const [k, v] of Object.entries(data)) a[k] = clean(v) === null ? null : JSON.parse(JSON.stringify(v));
          return a;
        },
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
      },
      auditIssue: {
        createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
          for (const d of data) mem.issues.push({ id: `i${++n}`, ...JSON.parse(JSON.stringify(d)) });
          return { count: data.length };
        },
        findMany: async ({ where }: { where: { auditId: string } }) => mem.issues.filter((i) => i.auditId === where.auditId),
        findFirst: async ({ where }: { where: { id: string; audit: { businessId: string } } }) => {
          const i = mem.issues.find((x) => x.id === where.id && mem.audits.get(x.auditId as string)?.businessId === where.audit.businessId);
          return i ? JSON.parse(JSON.stringify(i)) : null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const i = mem.issues.find((x) => x.id === where.id)!;
          Object.assign(i, data);
          return i;
        },
      },
      searchProperty: { findMany: async () => [] },
      business: { findUnique: async () => ({ widgetAllowedOrigins: mem.widgetOrigins }) },
      tenantSite: { findUnique: async () => null },
      searchMetricDaily: { groupBy: async () => [] },
    },
  };
});
vi.mock("@/lib/activity", () => ({
  createNotification: async (n: Record<string, unknown>) => void mem.notifications.push(n),
  logActivity: () => {},
}));
vi.mock("@/lib/plan-quota", () => ({ getEffectiveLimits: async () => ({ auditPageLimit: 200 }) }));
vi.mock("@/lib/llm", () => ({ aiStructured: vi.fn(), logUsage: vi.fn(), AiRefusalError: class extends Error {} }));
vi.mock("@/lib/brand", () => ({ getBrandContext: async () => "" }));

const llm = await import("@/lib/llm");
const { checkUrl, isPublicAddress, safeFetch, FetchBlockedError } = await import("@/lib/seo/fetch");
const { parseRobots, robotsPolicy, parseSitemap } = await import("@/lib/seo/robots");
const { parsePage } = await import("@/lib/seo/html");
const rules = await import("@/lib/seo/audit-rules");
const audit = await import("@/lib/seo/audit");

// ─── Address policy ──────────────────────────────────────────────────

describe("fetcher address policy", () => {
  it("refuses private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("checks URLs before any network use", () => {
    const blocked = (u: string, reason: string) => {
      try {
        checkUrl(u);
        throw new Error(`allowed ${u}`);
      } catch (e) {
        expect(e).toBeInstanceOf(FetchBlockedError);
        expect((e as InstanceType<typeof FetchBlockedError>).reason, u).toBe(reason);
      }
    };
    blocked("http://127.0.0.1/", "private_address");
    blocked("http://10.0.0.8/admin", "private_address");
    blocked("http://169.254.169.254/latest/meta-data/", "private_address");
    blocked("http://[::1]/", "private_address");
    blocked("http://[::ffff:127.0.0.1]/", "private_address");
    blocked("http://2130706433/", "private_address"); // 127.0.0.1 as a number
    blocked("ftp://example.com/", "protocol");
    blocked("file:///etc/passwd", "protocol");
    blocked("https://example.com:8443/", "port");
    blocked("https://user:pass@example.com/", "credentials");
    expect(checkUrl("https://example.com/a?b=1").href).toBe("https://example.com/a?b=1");
    expect(checkUrl("http://example.com:80/").host).toBe("example.com");
  });
});

// ─── Fetcher against a local server ───────────────────────────────────

let server: http.Server;
let port = 0;
const hits: string[] = [];

const SITE = () => `http://site.test:${port}`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(" ");
const cleanPage = (title: string, desc: string, h1: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${desc}"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${SITE()}/x"></head><body><h1>${h1}</h1><p>${words(300)}</p>${body}</body></html>`;

function route(host: string, path: string): { status: number; headers?: Record<string, string>; body?: string } {
  if (host.startsWith("ext.test")) return { status: 404, body: "gone" };
  switch (path) {
    case "/robots.txt":
      return { status: 200, headers: { "content-type": "text/plain" }, body: `User-agent: *\nDisallow: /private\n\nSitemap: ${SITE()}/sitemap.xml\n` };
    case "/sitemap.xml":
      return { status: 200, headers: { "content-type": "application/xml" }, body: `<?xml version="1.0"?><urlset><url><loc>${SITE()}/</loc></url><url><loc>${SITE()}/about</loc></url><url><loc>${SITE()}/orphan</loc></url></urlset>` };
    case "/":
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: cleanPage(
          "Acme Roofing Leeds | Repairs, Gutters and New Roofs",
          "Family-run roofers in Leeds since 1998. Free quotes for repairs, gutters and new roofs, with a ten-year guarantee on every job.",
          "Roofing in Leeds",
          `<script type="application/ld+json">{"@type":"RoofingContractor"}</script>
           <a href="/about">About</a> <a href="/services">Services</a> <a href="/private/secret">Secret</a>
           <a href="/missing">Missing</a> <a href="/old">Old</a> <a href="/hidden">Hidden</a> <a href="/dup">Dup</a>
           <a href="/files/price-list.pdf">Prices</a> <a href="http://ext.test:${port}/page">Partner</a>
           <a href="/about?utm_source=x#team">About again</a> <a href="mailto:hi@acme.test">Mail</a>
           <img src="/logo.png" alt="Acme Roofing logo">`
        ),
      };
    case "/about":
      return { status: 200, headers: { "content-type": "text/html" }, body: cleanPage("About Acme Roofing | Leeds Roofers Since 1998", "Meet the team behind Acme Roofing: three generations of Leeds roofers who still answer the phone themselves.", "About us", `<a href="/">Home</a><img src="/team.jpg" alt="">`) };
    case "/services":
      return { status: 200, headers: { "content-type": "text/html" }, body: `<html><head></head><body><h1>Services</h1><h1>Prices</h1><p>Short.</p><img src="/a.jpg"><img src="/b.jpg" alt="Gutter"></body></html>` };
    case "/hidden":
      return { status: 200, headers: { "content-type": "text/html" }, body: cleanPage("Hidden page for staff members only, not public", "A page we keep out of Google on purpose because it is only for staff and suppliers to read.", "Hidden", "").replace("<head>", '<head><meta name="robots" content="noindex, follow">') };
    case "/orphan":
    case "/dup":
      return { status: 200, headers: { "content-type": "text/html" }, body: cleanPage("Same title for two different pages on this site", "The same description is used on two pages, which makes them look alike to Google and to people.", path === "/dup" ? "Dup" : "Orphan", "") };
    case "/old":
      return { status: 301, headers: { location: "/older" } };
    case "/older":
      return { status: 301, headers: { location: "/about" } };
    case "/files/price-list.pdf":
      return { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" };
    case "/private/secret":
      return { status: 200, headers: { "content-type": "text/html" }, body: "<title>secret</title>" };
    case "/to-private":
      return { status: 302, headers: { location: "http://evil.test/" } };
    case "/to-metadata":
      return { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } };
    case "/to-other":
      return { status: 302, headers: { location: `http://other.test:${port}/` } };
    case "/loop":
      return { status: 302, headers: { location: "/loop2" } };
    case "/loop2":
      return { status: 302, headers: { location: "/loop" } };
    case "/big-site":
      return { status: 200, headers: { "content-type": "text/html" }, body: Array.from({ length: 260 }, (_, i) => `<a href="/p/${i}">${i}</a>`).join("") };
    case "/big":
      return { status: 200, headers: { "content-type": "text/html" }, body: "x".repeat(300_000) };
    default:
      if (path.startsWith("/p/")) return { status: 200, headers: { "content-type": "text/html" }, body: cleanPage(`Page ${path} of the big fixture site for crawl limits`, `Description for ${path}, long enough to count as a proper meta description for this page.`, path, "") };
      return { status: 404, headers: { "content-type": "text/html" }, body: "<title>Not found</title>" };
  }
}

const DNS: Record<string, string> = { "site.test": "127.0.0.1", "ext.test": "127.0.0.1", "other.test": "127.0.0.1", "evil.test": "10.0.0.5", "rebind.test": "192.168.1.20" };
const lookup = async (h: string) => (DNS[h] ? [{ address: DNS[h], family: 4 }] : Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" })));
// Only the fixture server's loopback address is let through; everything else private stays blocked.
const allowPrivate = (ip: string) => ip === "127.0.0.1";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    hits.push(`${req.method} ${req.headers.host?.split(":")[0]}${path} ${req.headers["user-agent"]}`);
    const r = route(req.headers.host ?? "", path);
    res.writeHead(r.status, r.headers);
    res.end(req.method === "HEAD" ? undefined : r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("safeFetch", () => {
  const opts = { lookup, allowPrivate };

  it("fetches through the guarded lookup and identifies itself", async () => {
    const r = await safeFetch(`${SITE()}/about`, opts);
    expect(r.status).toBe(200);
    expect(r.body).toContain("About us");
    expect(hits.at(-1)).toMatch(/DanetsAuditBot\/1\.0/);
  });

  it("refuses a public name that resolves to a private address", async () => {
    await expect(safeFetch(`http://rebind.test:${port}/`, opts)).rejects.toMatchObject({ reason: "private_address" });
  });

  it("refuses redirects to private names and metadata addresses", async () => {
    await expect(safeFetch(`${SITE()}/to-private`, opts)).rejects.toMatchObject({ reason: "private_address" });
    await expect(safeFetch(`${SITE()}/to-metadata`, opts)).rejects.toMatchObject({ reason: "private_address" });
  });

  it("stops at redirects the caller doesn't allow, and at loops", async () => {
    const r = await safeFetch(`${SITE()}/to-other`, { ...opts, allowRedirect: (u) => u.hostname === "site.test" });
    expect(r.status).toBe(302);
    expect(r.blockedRedirect).toBe(`http://other.test:${port}/`);
    await expect(safeFetch(`${SITE()}/loop`, opts)).rejects.toMatchObject({ reason: "too_many_redirects" });
    const chain = await safeFetch(`${SITE()}/old`, opts);
    expect(chain.redirects).toHaveLength(2);
    expect(chain.url).toBe(`${SITE()}/about`);
  });

  it("caps the body", async () => {
    const r = await safeFetch(`${SITE()}/big`, { ...opts, maxBytes: 1000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(1000);
  });

  it("without the test allowance, even the fixture server is refused", async () => {
    await expect(safeFetch(`${SITE()}/`, { lookup })).rejects.toBeInstanceOf(FetchBlockedError);
  });
});

// ─── robots.txt and sitemaps ──────────────────────────────────────────

describe("robots.txt", () => {
  it("uses the most specific group, longest rule, Allow on ties, wildcards and $", () => {
    const r = parseRobots(`# comment
User-agent: *
Disallow: /
Crawl-delay: 1

User-agent: DanetsAuditBot
User-agent: other
Disallow: /admin
Allow: /admin/public
Disallow: /*.pdf$
Disallow: /tmp*/cache
Crawl-delay: 2
Sitemap: https://acme.test/sitemap.xml`);
    const p = robotsPolicy(r, "DanetsAuditBot");
    expect(p.isAllowed("/")).toBe(true);
    expect(p.isAllowed("/admin/users")).toBe(false);
    expect(p.isAllowed("/admin/public/x")).toBe(true);
    expect(p.isAllowed("/files/a.pdf")).toBe(false);
    expect(p.isAllowed("/files/a.pdf?x=1")).toBe(true);
    expect(p.isAllowed("/tmp123/cache/x")).toBe(false);
    expect(p.isAllowed("/robots.txt")).toBe(true);
    expect(p.crawlDelay).toBe(2);
    expect(p.sitemaps).toEqual(["https://acme.test/sitemap.xml"]);
    const star = robotsPolicy(r, "SomeOtherBot");
    expect(star.isAllowed("/anything")).toBe(false);
    expect(robotsPolicy(parseRobots("User-agent: *\nDisallow:\n"), "x").isAllowed("/a")).toBe(true);
    expect(robotsPolicy(null, "x").isAllowed("/a")).toBe(true);
  });

  it("reads sitemaps and sitemap indexes", () => {
    expect(parseSitemap("<urlset><url><loc> https://a.test/?a=1&amp;b=2 </loc></url><url><loc><![CDATA[https://a.test/x]]></loc></url></urlset>")).toEqual({
      urls: ["https://a.test/?a=1&b=2", "https://a.test/x"],
      sitemaps: [],
    });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>")).toEqual({ urls: [], sitemaps: ["https://a.test/s1.xml"] });
  });
});

// ─── Page parsing and rules ─────────────────────────────────────────

describe("page parsing and rules", () => {
  it("extracts the SEO facts from HTML", () => {
    const f = parsePage(
      `<html lang="en"><head><base href="https://acme.test/sub/"><title> Hello &amp; welcome </title><meta name="Description" content=" Desc "><meta name="robots" content="NOINDEX"><link rel="canonical" href="/c"><script src="http://cdn.test/x.js"></script></head>
       <body><svg><title>icon</title></svg><h1>One <b>bold</b></h1><a href="p?x=1#frag" rel="nofollow">p</a><a href="javascript:void(0)">x</a><img src="i.png"><img src="j.png" alt=" "><script>var notText = 1;</script><p>Some visible words here</p></body></html>`,
      "https://acme.test/page"
    );
    expect(f.title).toBe("Hello & welcome");
    expect(f.titleCount).toBe(1);
    expect(f.metaDescription).toBe("Desc");
    expect(f.metaRobots).toBe("noindex");
    expect(f.canonical).toBe("https://acme.test/c");
    expect(f.h1).toEqual(["One bold"]);
    expect(f.links).toEqual([{ url: "https://acme.test/sub/p?x=1", nofollow: true }]);
    expect(f.images).toEqual([
      { src: "https://acme.test/sub/i.png", alt: null },
      { src: "https://acme.test/sub/j.png", alt: "" },
    ]);
    expect(f.mixedContent).toEqual(["http://cdn.test/x.js"]);
    expect(parsePage(`<script src="http://cdn.test/x.js"></script>`, "http://acme.test/").mixedContent).toEqual([]);
    expect(parsePage(`<script src="http://cdn.test/x.js"></script><img src="http://cdn.test/a.png">`, "https://acme.test/").mixedContent).toEqual(["http://cdn.test/x.js", "http://cdn.test/a.png"]);
    expect(f.textSample).toContain("Some visible words here");
    expect(f.textSample).not.toContain("notText");
    expect(f.lang).toBe("en");
  });

  it("reports nothing on a clean page", () => {
    const html = cleanPage("Acme Roofing Leeds | Repairs, Gutters and New Roofs", "Family-run roofers in Leeds since 1998, with free quotes for repairs, gutters and new roofs.", "Roofing", '<img src="/a.png" alt="Roof">');
    expect(rules.pageIssues("https://acme.test/about", parsePage(html, "https://acme.test/about"), { isHome: false })).toEqual([]);
  });

  it("finds planted problems on a page", () => {
    const f = parsePage(`<html><head><meta name="robots" content="noindex"><title>${"T".repeat(70)}</title></head><body><h1>a</h1><h1>b</h1><img src="x.png"></body></html>`, "https://acme.test/p");
    const codes = rules.pageIssues("https://acme.test/p", f, { isHome: true }).map((i) => i.code);
    expect(codes.sort()).toEqual(["missing_alt", "missing_canonical", "missing_lang", "missing_meta_description", "missing_structured_data", "missing_viewport", "multiple_h1", "noindex", "title_too_long"].sort());
  });

  it("finds duplicates, broken links and redirect chains", () => {
    const pages = [
      { url: "a", status: 200, title: "Same", description: "D1", noindex: false },
      { url: "b", status: 200, title: "same ", description: "D2", noindex: false },
      { url: "c", status: 200, title: "Same", description: "D3", noindex: true },
      { url: "d", status: 404, title: "Same", description: null, noindex: false },
    ];
    expect(rules.duplicateIssues(pages).map((i) => `${i.code}:${i.pageUrl}`)).toEqual(["duplicate_title:a", "duplicate_title:b"]);
    expect(
      rules
        .linkIssues([
          { from: "a", link: "x", status: 404, hops: 0, internal: true },
          { from: "a", link: "y", status: 0, hops: 0, internal: false },
          { from: "a", link: "z", status: 200, hops: 2, internal: true },
          { from: "a", link: "w", status: 200, hops: 1, internal: true },
        ])
        .map((i) => i.code)
    ).toEqual(["broken_link", "broken_link", "redirect_chain"]);
  });

  it("scores with per-code caps", () => {
    expect(rules.scoreFor([])).toBe(100);
    // 40 broken links cost at most the cap (15), not 80 points.
    expect(rules.scoreFor(Array.from({ length: 40 }, () => ({ code: "broken_link" as const })))).toBe(85);
    expect(rules.scoreFor([{ code: "no_https" }, { code: "missing_title" }, { code: "thin_content" }])).toBe(81); // 100 - 15 - 4 - 0.5, rounded
    // Every code at its cap still can't go below zero.
    const all = Object.keys(rules.ISSUE_DEFS).flatMap((code) => Array.from({ length: 50 }, () => ({ code: code as keyof typeof rules.ISSUE_DEFS })));
    expect(rules.scoreFor(all)).toBe(0);
    // Each cap is reachable and weights are positive.
    for (const def of Object.values(rules.ISSUE_DEFS)) expect(def.weight > 0 && def.cap >= def.weight).toBe(true);
  });

  it("reads Core Web Vitals from PageSpeed: field first, else lab", () => {
    const field = rules.vitalsFromPsi("u", {
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4100 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 15 } } },
      lighthouseResult: { categories: { performance: { score: 0.42 } } },
    });
    expect(field).toEqual({ url: "u", source: "field", lcpMs: 4100, inpMs: 180, cls: 0.15, performance: 42 });
    expect(rules.vitalsIssues(field).map((i) => [i.code, i.detail?.rating])).toEqual([
      ["slow_lcp", "poor"],
      ["high_cls", "needs_improvement"],
    ]);
    const lab = rules.vitalsFromPsi("u", { lighthouseResult: { audits: { "largest-contentful-paint": { numericValue: 2100.4 }, "cumulative-layout-shift": { numericValue: 0.0123 } } } });
    expect(lab).toMatchObject({ source: "lab", lcpMs: 2100, inpMs: null, cls: 0.012 });
    expect(rules.vitalsIssues(lab)).toEqual([]);
    expect(rules.rateVital("inpMs", 600)).toBe("poor");
    expect(rules.rateVital("cls", null)).toBeNull();
  });
});

// ─── Which sites a tenant may audit ───────────────────────────────────

describe("site ownership", () => {
  it("only allows the tenant's own sites", () => {
    const { owned, candidates } = audit.ownedFrom({
      propertyUrls: ["sc-domain:acme.test", "https://shop.other.test/"],
      widgetOrigins: ["https://www.widget.test", "not a url", 5],
      platformOrigin: "https://acme.danets.site",
    });
    expect(candidates.map((c) => c.source)).toEqual(["search_console", "search_console", "widget", "platform_site"]);
    expect(audit.isOwnedHost("acme.test", owned)).toBe(true);
    expect(audit.isOwnedHost("blog.acme.test", owned)).toBe(true);
    expect(audit.isOwnedHost("notacme.test", owned)).toBe(false);
    expect(audit.isOwnedHost("shop.other.test", owned)).toBe(true);
    expect(audit.isOwnedHost("other.test", owned)).toBe(false);
    expect(audit.isOwnedHost("widget.test", owned)).toBe(true); // www twin
    expect(audit.isOwnedHost("acme.danets.site", owned)).toBe(true);
    expect(audit.isOwnedHost("evil.danets.site", owned)).toBe(false);
  });

  it("normalises crawl URLs and typed addresses", () => {
    expect(audit.normalizeCrawlUrl("https://Acme.test/a?utm_source=x&id=2&gclid=y#top")).toBe("https://acme.test/a?id=2");
    expect(audit.normalizeSiteInput(" acme.test/path?x=1 ")).toBe("https://acme.test/path");
    expect(audit.normalizeSiteInput("javascript:alert(1)")).toBeNull();
    expect(audit.looksLikePage("https://a.test/x.pdf")).toBe(false);
    expect(audit.looksLikePage("https://a.test/x")).toBe(true);
  });
});

// ─── Crawling a fixture site ──────────────────────────────────────────

function newAudit(id: string) {
  mem.audits.set(id, {
    id,
    businessId: "b1",
    rootUrl: `${SITE()}/`,
    trigger: "manual",
    status: "queued",
    pageLimit: 200,
    pagesCrawled: 0,
    score: null,
    summary: null,
    vitals: null,
    state: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    createdAt: new Date().toISOString(),
  });
}

const found = (auditId: string) =>
  mem.issues
    .filter((i) => i.auditId === auditId)
    .map((i) => `${i.code} ${String(i.pageUrl).replace(SITE(), "")}${(i.detail as { link?: string } | undefined)?.link ? ` -> ${String((i.detail as { link: string }).link).replace(SITE(), "").replace(`http://ext.test:${port}`, "ext")}` : ""}`)
    .sort();

describe("crawl", () => {
  const run = { lookup, allowPrivate, delayMs: 0 };

  beforeEach(() => {
    mem.audits.clear();
    mem.issues.length = 0;
    mem.notifications.length = 0;
    mem.widgetOrigins = [SITE()];
  });

  it("finds every planted issue, with none on the clean page", async () => {
    newAudit("a1");
    expect(await audit.runAuditChunk("a1", run)).toBe("done");
    const a = mem.audits.get("a1")!;
    expect(a.status).toBe("done");
    expect(a.state).toBeNull();
    expect(found("a1")).toEqual(
      [
        "broken_link / -> /missing",
        "broken_link / -> ext/page",
        "duplicate_meta_description /dup",
        "duplicate_meta_description /orphan",
        "duplicate_title /dup",
        "duplicate_title /orphan",
        "missing_alt /services",
        "missing_canonical /services",
        "missing_lang /services",
        "missing_meta_description /services",
        "missing_title /services",
        "missing_viewport /services",
        "multiple_h1 /services",
        "no_https /",
        "noindex /hidden",
        "page_error /missing",
        "redirect_chain / -> /old",
        "thin_content /services",
      ].sort()
    );
    // The clean page (and the clean home page's own content) produced nothing.
    expect(found("a1").filter((s) => s.split(" ")[1] === "/about")).toEqual([]);
    // robots.txt was obeyed and the PDF was only checked, never parsed.
    expect(hits.some((h) => h.includes("/private/secret"))).toBe(false);
    expect(hits.some((h) => h.startsWith("HEAD site.test/files/price-list.pdf"))).toBe(true);
    // /, /about, /orphan (sitemap), /services, /missing, /old (followed to /about), /hidden, /dup.
    expect(a.pagesCrawled).toBe(8);
    const summary = a.summary as { critical: number; notes: string[] };
    expect(summary.critical).toBeGreaterThan(0);
    expect(summary.notes.join(" ")).toMatch(/robots\.txt/);
    expect(summary.notes.join(" ")).toMatch(/PageSpeed key/);
    expect(a.score).toBe(rules.scoreFor(mem.issues.map((i) => ({ code: i.code as keyof typeof rules.ISSUE_DEFS, detail: i.detail as Record<string, unknown> }))));
    expect(mem.notifications.at(-1)).toMatchObject({ type: "site_audit_done" });
  });

  it("resumes from checkpoints and after a crash, with the same result", async () => {
    newAudit("full");
    await audit.runAuditChunk("full", run);
    const expected = found("full").map((s) => s);

    // One page per run (budget exhausted immediately).
    newAudit("sliced");
    let runs = 0;
    while ((await audit.runAuditChunk("sliced", { ...run, budgetMs: -1 })) === "continue") runs++;
    expect(runs).toBeGreaterThan(5);
    expect(found("sliced")).toEqual(expected);

    // A worker killed mid-run: the run throws, the next run picks up from the checkpoint.
    newAudit("crash");
    const ctl = new AbortController();
    let n = 0;
    const crashing = { ...run, lookup: async (h: string) => (++n === 6 ? (ctl.abort(), lookup(h)) : lookup(h)), signal: ctl.signal };
    await audit.runAuditChunk("crash", crashing).catch(() => "crashed");
    expect(mem.audits.get("crash")!.status).toBe("running");
    while ((await audit.runAuditChunk("crash", run)) === "continue");
    expect(found("crash")).toEqual(expected);
  });

  it("stops a 200-page crawl at the plan limit, in slices", async () => {
    newAudit("big");
    mem.audits.get("big")!.rootUrl = `${SITE()}/big-site`;
    const started = Date.now();
    let runs = 1;
    while ((await audit.runAuditChunk("big", { ...run, budgetMs: 1500 })) === "continue") runs++;
    const a = mem.audits.get("big")!;
    expect(a.status).toBe("done");
    expect(a.pagesCrawled).toBe(200);
    expect((a.summary as { notes: string[] }).notes.join(" ")).toMatch(/limit of 200 pages/);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(runs).toBeGreaterThanOrEqual(1);
  }, 40_000);

  it("refuses a site that isn't the tenant's", async () => {
    mem.widgetOrigins = ["https://someone-else.test"];
    newAudit("x");
    expect(await audit.runAuditChunk("x", run)).toBe("done");
    expect(mem.audits.get("x")).toMatchObject({ status: "failed", error: expect.stringMatching(/no longer linked/) });
  });

  it("adds Core Web Vitals when PageSpeed is available", async () => {
    newAudit("v");
    await audit.runAuditChunk("v", {
      ...run,
      pagespeed: async () => ({ loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 5000 } } } }),
    });
    expect(found("v")).toContain("slow_lcp /");
    expect(mem.audits.get("v")!.vitals).toEqual([{ url: `${SITE()}/`, source: "field", lcpMs: 5000, inpMs: null, cls: null, performance: null }]);
  });

  describe("the real PageSpeed request", () => {
    const calls: string[] = [];
    const psiBody = {
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2300, category: "FAST" }, INTERACTION_TO_NEXT_PAINT: { percentile: 640, category: "SLOW" }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" } } },
      lighthouseResult: { categories: { performance: { score: 0.71 } }, audits: { "largest-contentful-paint": { numericValue: 3100 }, "cumulative-layout-shift": { numericValue: 0.02 } } },
    };
    const stubFetch = (respond: () => Response) =>
      vi.stubGlobal("fetch", async (u: string | URL) => {
        calls.push(String(u));
        return respond();
      });
    beforeEach(() => {
      calls.length = 0;
      vi.stubEnv("PAGESPEED_API_KEY", "test-psi-key");
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("asks Google for a mobile performance report with the platform key and reads it", async () => {
      stubFetch(() => Response.json(psiBody));
      newAudit("p");
      await audit.runAuditChunk("p", run);
      expect(calls).toHaveLength(1);
      const q = new URL(calls[0]);
      expect(q.origin + q.pathname).toBe("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      expect(Object.fromEntries(q.searchParams)).toEqual({ url: `${SITE()}/`, strategy: "mobile", category: "performance", key: "test-psi-key" });
      expect(mem.audits.get("p")!.vitals).toEqual([{ url: `${SITE()}/`, source: "field", lcpMs: 2300, inpMs: 640, cls: 0.05, performance: 71 }]);
      expect(found("p")).toContain("slow_inp /");
      expect((mem.audits.get("p")!.summary as { notes: string[] }).notes.join(" ")).not.toMatch(/PageSpeed/);
    });

    it("finishes the audit and says so when Google refuses (quota, bad key)", async () => {
      stubFetch(() => Response.json({ error: { code: 429, message: "Quota exceeded" } }, { status: 429 }));
      newAudit("q");
      expect(await audit.runAuditChunk("q", run)).toBe("done");
      const a = mem.audits.get("q")!;
      expect(a.status).toBe("done");
      expect(a.vitals).toEqual([]);
      expect((a.summary as { notes: string[] }).notes.join(" ")).toMatch(/couldn't be checked this time/);
    });
  });
});

// ─── AI fix suggestions ───────────────────────────────────────────────

describe("suggest a fix", () => {
  const run = { lookup, allowPrivate, delayMs: 0 };
  const actor = { businessId: "b1", userId: "u1" } as Parameters<typeof audit.suggestFix>[0];
  const ai = vi.mocked(llm.aiStructured);
  const usage = vi.mocked(llm.logUsage);
  const issueFor = (code: string, page: string) => mem.issues.find((i) => i.code === code && i.pageUrl === `${SITE()}${page}`)!;

  beforeAll(async () => {
    mem.audits.clear();
    mem.issues.length = 0;
    mem.widgetOrigins = [SITE()];
    newAudit("s");
    await audit.runAuditChunk("s", run);
  });
  beforeEach(() => {
    ai.mockReset();
    usage.mockReset();
    mem.widgetOrigins = [SITE()];
  });

  it("reads the live page, asks the AI with its content, and saves the suggestion", async () => {
    ai.mockResolvedValue({ data: { suggestions: [{ text: "Roofing services in Leeds: repairs, gutters and new roofs, with free quotes." }] }, promptTokens: 400, completionTokens: 40, totalTokens: 440 } as never);
    const issue = issueFor("missing_meta_description", "/services");
    const out = await audit.suggestFix(actor, issue.id as string, run);
    expect(out.suggestion).toBe("Roofing services in Leeds: repairs, gutters and new roofs, with free quotes.");
    expect(out.suggestedAt).toBeInstanceOf(Date);
    expect(issueFor("missing_meta_description", "/services").suggestion).toBe(out.suggestion);

    const [messages, , opts] = ai.mock.calls[0];
    const user = (messages as { role: string; content: string }[]).find((m) => m.role === "user")!.content;
    expect(user).toContain(`Page: ${SITE()}/services`);
    expect(user).toMatch(/H1\): Services \| Prices/);
    expect(user).toMatch(/meta description/i);
    expect(opts).toMatchObject({ businessId: "b1", task: "content" });
    expect(usage).toHaveBeenCalledWith("b1", "seo_fix", expect.objectContaining({ totalTokens: 440 }));
  });

  it("labels each suggestion when there are several", async () => {
    ai.mockResolvedValue({ data: { suggestions: [{ for: "/a.jpg", text: "Roofer fixing slates" }, { for: "/b.jpg", text: "New gutter" }] }, promptTokens: 1, completionTokens: 1, totalTokens: 2 } as never);
    const out = await audit.suggestFix(actor, issueFor("missing_alt", "/services").id as string, run);
    expect(out.suggestion).toBe("/a.jpg\n→ Roofer fixing slates\n\n/b.jpg\n→ New gutter");
  });

  it("refuses issues it can't help with, other tenants' issues and unlinked sites, without calling the AI", async () => {
    const err = (p: Promise<unknown>) => p.then(() => null, (e) => ({ status: e.status, code: e.code }));
    expect(await err(audit.suggestFix(actor, issueFor("page_error", "/missing").id as string, run))).toEqual({ status: 400, code: "AUDIT_INVALID" });
    expect(await err(audit.suggestFix({ ...actor, businessId: "b2" }, issueFor("missing_title", "/services").id as string, run))).toEqual({ status: 404, code: "NOT_FOUND" });
    mem.widgetOrigins = ["https://someone-else.test"];
    expect(await err(audit.suggestFix(actor, issueFor("missing_title", "/services").id as string, run))).toEqual({ status: 400, code: "AUDIT_INVALID" });
    expect(ai).not.toHaveBeenCalled();
  });

  it("turns AI failures and refusals into clear errors and logs them", async () => {
    const id = issueFor("missing_title", "/services").id as string;
    ai.mockRejectedValueOnce(new Error("provider down"));
    await expect(audit.suggestFix(actor, id, run)).rejects.toMatchObject({ status: 502, code: "AI_FAILED" });
    expect(usage).toHaveBeenLastCalledWith("b1", "seo_fix", expect.anything(), "error", "provider down");
    ai.mockRejectedValueOnce(new llm.AiRefusalError("anthropic", "test-model"));
    await expect(audit.suggestFix(actor, id, run)).rejects.toMatchObject({ status: 422, code: "AI_REFUSED" });
    expect(issueFor("missing_title", "/services").suggestion).toBeUndefined();
  });
});
