// Extract the SEO-relevant facts from one HTML page (site audit, W).
// Streaming parse with htmlparser2: no DOM, so a large page stays cheap.

import { Parser } from "htmlparser2";

export interface PageLink {
  /** Absolute URL, fragment removed. */
  url: string;
  nofollow: boolean;
}

export interface PageImage {
  src: string;
  /** null = no alt attribute at all; "" = decorative (alt=""). */
  alt: string | null;
}

export interface PageFacts {
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  hasViewport: boolean;
  h1: string[];
  links: PageLink[];
  images: PageImage[];
  /** http:// sub-resources on an https page. */
  mixedContent: string[];
  jsonLdCount: number;
  wordCount: number;
  /** The start of the visible text, for AI suggestions. */
  textSample: string;
}

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head", "title"]);
const SAMPLE_CHARS = 2000;

function absolute(href: string | undefined, base: URL): URL | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || /^(javascript|mailto|tel|data|sms|fax|about|blob):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function parsePage(html: string, pageUrl: string): PageFacts {
  let base = new URL(pageUrl);
  const isHttps = base.protocol === "https:";
  const facts: PageFacts = {
    title: null,
    titleCount: 0,
    metaDescription: null,
    metaRobots: null,
    canonical: null,
    lang: null,
    hasViewport: false,
    h1: [],
    links: [],
    images: [],
    mixedContent: [],
    jsonLdCount: 0,
    wordCount: 0,
    textSample: "",
  };
  const stack: string[] = [];
  let skipDepth = 0;
  let titleBuf: string | null = null;
  let h1Buf: string | null = null;
  let h1Depth = 0;
  const text: string[] = [];
  let sampleLen = 0;
  const seenLinks = new Set<string>();

  const mixed = (raw: string | undefined) => {
    if (!isHttps || !raw) return;
    const u = absolute(raw, base);
    if (u && u.protocol === "http:" && !facts.mixedContent.includes(u.href)) facts.mixedContent.push(u.href);
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        stack.push(name);
        if (SKIP_TEXT.has(name)) skipDepth++;
        switch (name) {
          case "html":
            if (attrs.lang) facts.lang = attrs.lang.trim() || null;
            break;
          case "base": {
            const b = absolute(attrs.href, base);
            if (b) base = b;
            break;
          }
          case "title":
            if (!stack.includes("svg")) {
              facts.titleCount++;
              if (facts.titleCount === 1) titleBuf = "";
            }
            break;
          case "meta": {
            const n = (attrs.name || "").toLowerCase();
            if (n === "description" && facts.metaDescription === null) facts.metaDescription = squash(attrs.content ?? "");
            else if ((n === "robots" || n === "googlebot") && attrs.content) facts.metaRobots = [facts.metaRobots, attrs.content.toLowerCase()].filter(Boolean).join(", ");
            else if (n === "viewport") facts.hasViewport = true;
            break;
          }
          case "link": {
            const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
            if (rel.includes("canonical") && facts.canonical === null) facts.canonical = absolute(attrs.href, base)?.href ?? null;
            if (rel.includes("stylesheet")) mixed(attrs.href);
            break;
          }
          case "script":
            if ((attrs.type || "").toLowerCase() === "application/ld+json") facts.jsonLdCount++;
            mixed(attrs.src);
            break;
          case "h1":
            h1Depth++;
            if (h1Depth === 1) h1Buf = "";
            break;
          case "a": {
            const u = absolute(attrs.href, base);
            if (u && !seenLinks.has(u.href)) {
              seenLinks.add(u.href);
              facts.links.push({ url: u.href, nofollow: (attrs.rel || "").toLowerCase().split(/\s+/).includes("nofollow") });
            }
            break;
          }
          case "img": {
            const src = absolute(attrs.src || attrs["data-src"], base);
            if (src) facts.images.push({ src: src.href, alt: attrs.alt === undefined ? null : attrs.alt.trim() });
            mixed(attrs.src);
            break;
          }
          case "iframe":
          case "audio":
          case "video":
          case "source":
          case "embed":
            mixed(attrs.src);
            break;
        }
      },
      ontext(data) {
        if (titleBuf !== null && stack[stack.length - 1] === "title") titleBuf += data;
        if (h1Buf !== null) h1Buf += data;
        if (skipDepth > 0) return;
        const t = data.replace(/\s+/g, " ");
        if (!t.trim()) return;
        text.push(t);
        if (sampleLen < SAMPLE_CHARS) sampleLen += t.length;
      },
      onclosetag(name) {
        if (name === "title" && titleBuf !== null) {
          facts.title = squash(titleBuf);
          titleBuf = null;
        }
        if (name === "h1" && h1Depth > 0) {
          h1Depth--;
          if (h1Depth === 0 && h1Buf !== null) {
            facts.h1.push(squash(h1Buf));
            h1Buf = null;
          }
        }
        if (SKIP_TEXT.has(name) && skipDepth > 0) skipDepth--;
        const i = stack.lastIndexOf(name);
        if (i >= 0) stack.length = i;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true }
  );
  parser.write(html);
  parser.end();

  const all = squash(text.join(" "));
  facts.wordCount = all ? all.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  facts.textSample = all.slice(0, SAMPLE_CHARS);
  if (facts.title === "") facts.title = null;
  return facts;
}
