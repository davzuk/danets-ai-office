// robots.txt for the site audit crawler (W). Pure: parsing and matching
// follow Google's rules (RFC 9309): the group naming the bot wins (else `*`),
// then the longest matching rule, with Allow winning a tie; `*` matches any
// run of characters and a trailing `$` anchors the end.

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

export interface Robots {
  groups: Group[];
  sitemaps: string[];
}

export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // An empty Disallow allows everything; an empty Allow means nothing.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

/** Pick the group(s) naming the bot's product token (case-insensitive, exact), else `*`. */
function groupFor(robots: Robots, token: string): Group[] {
  const t = token.toLowerCase();
  const picked = robots.groups.filter((g) => g.agents.includes(t));
  if (picked.length) return picked;
  return robots.groups.filter((g) => g.agents.includes("*"));
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** Percent-encode the way robots.txt rules are compared (keep reserved chars, normalise case of escapes). */
function normalizePath(p: string): string {
  try {
    return encodeURI(decodeURI(p));
  } catch {
    return p;
  }
}

export interface RobotsPolicy {
  isAllowed(pathAndQuery: string): boolean;
  /** Seconds between requests the site asked for, or null. */
  crawlDelay: number | null;
  sitemaps: string[];
}

export function robotsPolicy(robots: Robots | null, token: string): RobotsPolicy {
  if (!robots) return { isAllowed: () => true, crawlDelay: null, sitemaps: [] };
  const groups = groupFor(robots, token);
  const rules = groups.flatMap((g) => g.rules).map((r) => ({ ...r, re: patternToRegExp(normalizePath(r.pattern)), len: r.pattern.length }));
  const delays = groups.map((g) => g.crawlDelay).filter((d): d is number => d !== null);
  return {
    isAllowed(pathAndQuery) {
      const path = normalizePath(pathAndQuery || "/");
      if (path === "/robots.txt") return true;
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (!r.re.test(path)) continue;
        if (!best || r.len > best.len || (r.len === best.len && r.allow && !best.allow)) best = { allow: r.allow, len: r.len };
      }
      return best ? best.allow : true;
    },
    crawlDelay: delays.length ? Math.max(...delays) : null,
    sitemaps: robots.sitemaps,
  };
}

/** `<loc>` values from a sitemap or sitemap index. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  );
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}
