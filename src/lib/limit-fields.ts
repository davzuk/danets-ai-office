// Every numeric quota a plan sets and a tenant override can replace. One list,
// used by the plan catalog API, the tenant override API and both editors in
// the platform console, so a new limit can't be added to one and missed in
// another. Pure: safe to import from client components.
//
// Keep `fallback` in step with getEffectiveLimits in src/lib/plan-quota.ts.

export const LIMIT_FIELDS = [
  { key: "chatLimit", label: "Chats & AI requests", unit: "/mo", fallback: 100, hint: "Chat sessions per month. Also the monthly AI request quota (replies, content generation, brand voice)." },
  { key: "leadLimit", label: "Leads", unit: "/mo", fallback: 50 },
  { key: "kbLimit", label: "Knowledge base articles", unit: "total", fallback: 25 },
  { key: "agentLimit", label: "AI agents", unit: "total", fallback: 1 },
  { key: "ticketLimit", label: "Support tickets", unit: "/mo", fallback: 100 },
  { key: "documentLimit", label: "Documents", unit: "total", fallback: 25 },
  { key: "automationLimit", label: "Automations", unit: "total", fallback: 5 },
  { key: "seatLimit", label: "Team seats", unit: "total", fallback: 3 },
  { key: "whatsappTemplateLimit", label: "WhatsApp templates", unit: "total", fallback: 5 },
  { key: "integrationLimit", label: "Integrations", unit: "total", fallback: 3 },
  { key: "proposalTemplateLimit", label: "Proposal templates", unit: "total", fallback: 10 },
  { key: "quoteLimit", label: "Quotes", unit: "/mo", fallback: 50 },
  { key: "bookingTypeLimit", label: "Booking types", unit: "total", fallback: 3 },
  { key: "pageLimit", label: "Published website pages", unit: "total", fallback: 3 },
  { key: "formLimit", label: "Lead capture forms", unit: "total", fallback: 3 },
  { key: "leadMagnetLimit", label: "Lead magnets", unit: "total", fallback: 3 },
  { key: "seoPropertyLimit", label: "Search Console properties", unit: "total", fallback: 1 },
  { key: "gbpLocationLimit", label: "Business Profile locations", unit: "total", fallback: 1 },
  { key: "auditPageLimit", label: "Site audit pages", unit: "total", fallback: 200, hint: "Pages one site audit may crawl." },
  { key: "trackedKeywordLimit", label: "Tracked SEO keywords", unit: "total", fallback: 50 },
  { key: "mediaStorageMbLimit", label: "Media storage", unit: "MB", fallback: 1024, hint: "Media library storage in MB (1024 = 1 GB)." },
] as const satisfies readonly { key: string; label: string; unit: string; fallback: number; hint?: string }[];

export type LimitKey = (typeof LIMIT_FIELDS)[number]["key"];
export type LimitValues = Record<LimitKey, number>;
export type LimitOverrides = Record<LimitKey, number | null>;

export const LIMIT_KEYS = LIMIT_FIELDS.map((f) => f.key) as LimitKey[];

/** 0 means unlimited everywhere quotas are checked. */
export function formatLimit(value: number, unit: string): string {
  if (value <= 0) return "Unlimited";
  if (unit === "MB") return value >= 1024 ? `${+(value / 1024).toFixed(1)} GB` : `${value} MB`;
  return `${value.toLocaleString()}${unit === "/mo" ? "/mo" : ""}`;
}

/** Pick the limit columns off a plan or override row. */
export function pickLimits<T extends Partial<Record<LimitKey, number | null>>>(row: T | null | undefined, withFallback: true): LimitValues;
export function pickLimits<T extends Partial<Record<LimitKey, number | null>>>(row: T | null | undefined, withFallback: false): LimitOverrides;
export function pickLimits<T extends Partial<Record<LimitKey, number | null>>>(row: T | null | undefined, withFallback: boolean) {
  return Object.fromEntries(
    LIMIT_FIELDS.map((f) => [f.key, row?.[f.key] ?? (withFallback ? f.fallback : null)])
  );
}
