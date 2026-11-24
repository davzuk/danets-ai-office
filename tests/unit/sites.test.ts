import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ db: { tenantSite: { findUnique } } }));

const { siteOrigin, siteSubdomainFromHost, sitesDomain, subdomainProblem, suggestSubdomain, PAGE_SLUG_RE } = await import("@/lib/sites/host");
const { isSafeHref, isImageUrl, parseVideoUrl, validateBlocks, pageBlocksSchema, readBlocks, readableOn, newBlock, SITE_BLOCK_DEFS, SITE_BLOCK_KEYS, SITE_BLOCK_SCHEMAS } = await import(
  "@/lib/sites/blocks"
);
const { renderInline } = await import("@/components/sites/site-blocks");
const { normalizeSlug, slugProblem } = await import("@/lib/sites/service");
const { blockedOriginFor } = await import("@/lib/public-cors");
const { middleware } = await import("@/middleware");

const prodEnv = { NODE_ENV: "production", SITES_DOMAIN: "Danets.site" };
const devEnv = { NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };

describe("site hosts", () => {
  it("reads the sites domain from env, with a localhost fallback in development only", () => {
    expect(sitesDomain(prodEnv)).toBe("danets.site");
    expect(sitesDomain({ NODE_ENV: "production" })).toBeNull();
    expect(sitesDomain(devEnv)).toBe("localhost:3000");
    expect(sitesDomain({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "https://app.example.com" })).toBeNull();
  });

  it("maps tenant hosts to subdomains and nothing else", () => {
    expect(siteSubdomainFromHost("acme.danets.site", prodEnv)).toBe("acme");
    expect(siteSubdomainFromHost("ACME.danets.site", prodEnv)).toBe("acme");
    expect(siteSubdomainFromHost("danets.site", prodEnv)).toBeNull();
    expect(siteSubdomainFromHost("a.b.danets.site", prodEnv)).toBeNull();
    expect(siteSubdomainFromHost("www.danets.site", prodEnv)).toBeNull();
    expect(siteSubdomainFromHost("app.danets.site", prodEnv)).toBeNull();
    expect(siteSubdomainFromHost("acme.danets.site.evil.com", prodEnv)).toBeNull();
    expect(siteSubdomainFromHost("acme.localhost:3000", devEnv)).toBe("acme");
    expect(siteSubdomainFromHost("localhost:3000", devEnv)).toBeNull();
    expect(siteSubdomainFromHost("acme.localhost:4000", devEnv)).toBeNull();
    expect(siteSubdomainFromHost(null, prodEnv)).toBeNull();
  });

  it("builds origins with https except on localhost", () => {
    expect(siteOrigin("acme", prodEnv)).toBe("https://acme.danets.site");
    expect(siteOrigin("acme", devEnv)).toBe("http://acme.localhost:3000");
    expect(siteOrigin("acme", { NODE_ENV: "production" })).toBeNull();
  });

  it("checks and suggests subdomains", () => {
    expect(subdomainProblem("acme-roofing")).toBeNull();
    expect(subdomainProblem("ab")).toMatch(/3 to 32/);
    expect(subdomainProblem("-acme")).toMatch(/3 to 32/);
    expect(subdomainProblem("Acme")).toMatch(/3 to 32/);
    expect(subdomainProblem("admin")).toMatch(/reserved/);
    expect(suggestSubdomain("Acme Roofing & Sons Ltd.")).toBe("acme-roofing-sons-ltd");
    expect(suggestSubdomain("Zé")).toBe("ze-site");
    expect(suggestSubdomain("Admin")).toBe("admin-co");
    expect(subdomainProblem(suggestSubdomain("A very long business name that keeps going on and on"))).toBeNull();
  });
});

describe("page slugs", () => {
  it("allows up to three lowercase segments and keeps reserved paths free", () => {
    expect(PAGE_SLUG_RE.test("roofing")).toBe(true);
    expect(PAGE_SLUG_RE.test("services/roofing/flat")).toBe(true);
    expect(PAGE_SLUG_RE.test("a/b/c/d")).toBe(false);
    expect(PAGE_SLUG_RE.test("Roofing")).toBe(false);
    expect(PAGE_SLUG_RE.test("roof--ing")).toBe(true);
    expect(PAGE_SLUG_RE.test("-roofing")).toBe(false);
    expect(normalizeSlug(" /Services/Roofing/ ")).toBe("services/roofing");
    expect(slugProblem("")).toBeNull();
    expect(slugProblem("services")).toBeNull();
    expect(slugProblem("api/x")).toMatch(/reserved/);
    expect(slugProblem("robots.txt")).not.toBeNull();
    expect(slugProblem("has space")).not.toBeNull();
  });
});

describe("safe links and media", () => {
  it("accepts paths, anchors, web, mail and phone links only", () => {
    for (const ok of ["/about", "#contact", "https://example.com/x", "http://example.com", "mailto:hi@example.com", "tel:+234 803 000 0000"]) expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "//evil.com", "/\\evil.com", "#a b", "", "vbscript:x", "ftp://x.com"]) expect(isSafeHref(bad), bad).toBe(false);
    expect(isImageUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isImageUrl("javascript:alert(1)")).toBe(false);
    expect(isImageUrl("/uploads/a.png")).toBe(false);
  });

  it("turns YouTube and Vimeo links into privacy-friendly embeds", () => {
    const yt = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")?.embedUrl).toBe(yt);
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")?.embedUrl).toBe(yt);
    expect(parseVideoUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.embedUrl).toBe(yt);
    expect(parseVideoUrl("https://vimeo.com/76979871")?.embedUrl).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(parseVideoUrl("https://www.youtube.com/watch?v=bad")).toBeNull();
    expect(parseVideoUrl("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
  });

  it("renders bold and safe links inline, and unsafe links as plain text", () => {
    const html = (t: string) => renderToStaticMarkup(createElement(Fragment, null, ...renderInline(t)));
    expect(html("Call **now** or [email us](mailto:hi@example.com).")).toContain("<strong>now</strong>");
    expect(html("[email us](mailto:hi@example.com)")).toContain('href="mailto:hi@example.com"');
    const bad = html("[click](javascript:alert(1)) <script>x</script>");
    expect(bad).not.toContain("href");
    expect(bad).not.toContain("<script>");
    expect(bad).toContain("click");
    const external = html("[site](https://example.com)");
    expect(external).toContain('rel="noopener noreferrer');
  });
});

describe("blocks", () => {
  it("has editor fields and valid defaults for every block", () => {
    for (const key of SITE_BLOCK_KEYS) {
      expect(SITE_BLOCK_DEFS[key], key).toBeDefined();
      const names = Object.keys((SITE_BLOCK_SCHEMAS[key] as unknown as { shape: Record<string, unknown> }).shape);
      for (const f of SITE_BLOCK_DEFS[key].fields) expect(names, `${key}.${f.name}`).toContain(f.name);
    }
    // Video and gallery need the tenant's own media before they can publish.
    const starter = SITE_BLOCK_KEYS.filter((k) => k !== "video" && k !== "gallery").map((k, i) => newBlock(k, `b${i}`));
    expect(validateBlocks(starter).issues).toEqual([]);
  });

  it("validates props and reports problems per block", () => {
    const { blocks, issues } = validateBlocks([
      { id: "a", blockKey: "hero", props: { title: "Hi", primaryCtaLabel: "Go", primaryCtaHref: "javascript:alert(1)" } },
      { id: "b", blockKey: "feature-grid", props: { columns: "3", items: [{ title: "One", description: "Desc" }] } },
      { id: "c", blockKey: "video", props: { url: "https://evil.com/x" } },
    ]);
    expect(blocks.map((b) => b.id)).toEqual(["b"]);
    expect(blocks[0].props.columns).toBe(3);
    expect(issues.map((i) => [i.blockId, i.index])).toEqual([
      ["a", 0],
      ["c", 2],
    ]);
    expect(issues[0].messages.join()).toMatch(/primaryCtaHref/);
  });

  it("checks draft structure: ids, keys, size", () => {
    expect(pageBlocksSchema.safeParse([{ id: "a", blockKey: "hero", props: {} }]).success).toBe(true);
    expect(pageBlocksSchema.safeParse([{ id: "a b", blockKey: "hero", props: {} }]).success).toBe(false);
    expect(pageBlocksSchema.safeParse([{ id: "a", blockKey: "script", props: {} }]).success).toBe(false);
    expect(pageBlocksSchema.safeParse([{ id: "a", blockKey: "hero", props: {} }, { id: "a", blockKey: "cta", props: {} }]).success).toBe(false);
    expect(pageBlocksSchema.safeParse(Array.from({ length: 41 }, (_, i) => ({ id: `b${i}`, blockKey: "cta", props: {} }))).success).toBe(false);
    expect(pageBlocksSchema.safeParse([{ id: "a", blockKey: "rich-text", props: { body: "x".repeat(210_000) } }]).success).toBe(false);
    expect(readBlocks("nonsense")).toEqual([]);
  });

  it("picks readable text for a colour", () => {
    expect(readableOn("#ffffff")).toBe("#111827");
    expect(readableOn("#facc15")).toBe("#111827");
    expect(readableOn("#1d4ed8")).toBe("#ffffff");
    expect(readableOn("#000000")).toBe("#ffffff");
  });
});

describe("widget origin on the tenant's own site", () => {
  const req = (origin: string) => new NextRequest("http://localhost:3000/api/public/chat", { method: "POST", headers: { origin } });
  const business = { id: "biz1", widgetAllowedOrigins: ["example.com"] };
  const prev = process.env.SITES_DOMAIN;
  beforeAll(() => {
    process.env.SITES_DOMAIN = "danets.site";
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.SITES_DOMAIN;
    else process.env.SITES_DOMAIN = prev;
  });

  it("lets the business's own site through a locked list, and no one else's", async () => {
    findUnique.mockResolvedValue({ businessId: "biz1" });
    expect(await blockedOriginFor(req("https://example.com"), business)).toBeNull();
    expect(await blockedOriginFor(req("https://acme.danets.site"), business)).toBeNull();
    findUnique.mockResolvedValue({ businessId: "other" });
    expect((await blockedOriginFor(req("https://rival.danets.site"), business))?.status).toBe(403);
    findUnique.mockResolvedValue(null);
    expect((await blockedOriginFor(req("https://nobody.danets.site"), business))?.status).toBe(403);
    expect((await blockedOriginFor(req("https://evil.com"), business))?.status).toBe(403);
  });
});

describe("middleware routing", () => {
  const prev = { sites: process.env.SITES_DOMAIN, app: process.env.NEXT_PUBLIC_APP_URL, hosts: process.env.APP_HOSTS };
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  beforeAll(() => {
    process.env.SITES_DOMAIN = "danets.site";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.danets.com";
    process.env.APP_HOSTS = "danets.com, www.danets.com";
  });
  afterAll(() => {
    restore("SITES_DOMAIN", prev.sites);
    restore("NEXT_PUBLIC_APP_URL", prev.app);
    restore("APP_HOSTS", prev.hosts);
  });
  const run = (host: string, path: string) => middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  const rewrite = (r: Response) => {
    const to = r.headers.get("x-middleware-rewrite");
    return to ? new URL(to).pathname : null;
  };

  it("rewrites tenant pages to the renderer with a tenant CSP", () => {
    const home = run("acme.danets.site", "/");
    expect(rewrite(home)).toBe("/site-render/acme");
    const page = run("acme.danets.site", "/services/roofing");
    expect(rewrite(page)).toBe("/site-render/acme/services/roofing");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline' 'strict-dynamic' https://js.paystack");
    expect(rewrite(run("acme.danets.site", "/sitemap.xml"))).toBe("/site-render/acme/sitemap.xml");
    expect(rewrite(run("acme.danets.site", "/robots.txt"))).toBe("/site-render/acme/robots.txt");
  });

  it("keeps the app off tenant hosts and the renderer off the app host", () => {
    // Page-shaped paths reach the renderer, scoped to this tenant, which 404s
    // unless the tenant published a page there.
    for (const p of ["/app", "/login", "/platform", "/site-render/other/x"]) expect(rewrite(run("acme.danets.site", p)), p).toBe(`/site-render/acme${p}`);
    for (const p of ["/api/site", "/api/auth/me", "/Roofing", "/a/b/c/d", "/_next/x"]) expect(run("acme.danets.site", p).status, p).toBe(404);
    expect(run("acme.danets.site", "/api/public/chat").headers.get("x-middleware-next")).toBe("1");
    expect(run("app.danets.com", "/site-render/acme").status).toBe(404);
    expect(run("app.danets.com", "/site-render").status).toBe(404);
    expect(rewrite(run("app.danets.com", "/roofing"))).toBeNull();
  });

  it("no longer sends other hostnames to the renderer (white-label domains come later)", () => {
    expect(rewrite(run("www.acme.com", "/"))).toBeNull();
    expect(rewrite(run("www.acme.com", "/services/roofing"))).toBeNull();
    expect(run("www.acme.com", "/api/public/chat").headers.get("x-middleware-next")).toBe("1");
  });

  it("serves the app on every app hostname and nothing on bare sites hosts", () => {
    for (const h of ["app.danets.com", "danets.com", "www.danets.com", "localhost:3000", "127.0.0.1:3000", "10.0.0.5:3000"]) expect(rewrite(run(h, "/pricing")), h).toBeNull();
    expect(run("danets.com", "/pricing").status).toBe(200);
    for (const h of ["danets.site", "sites.danets.site", "www.danets.site"]) expect(run(h, "/").status, h).toBe(404);
    expect(run("sites.danets.site", "/api/public/domains/check").status).toBe(200);
  });

  it("lets the dashboard frame the editor preview only", () => {
    expect(run("app.danets.com", "/site-preview").headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(run("app.danets.com", "/app").headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
