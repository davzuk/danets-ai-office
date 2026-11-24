/**
 * Central registry for tenant modules — drives nav visibility, API gates, and plan upsells.
 */

export const PLAN_ORDER = ["free", "starter", "pro", "enterprise"] as const;
export type PlanName = (typeof PLAN_ORDER)[number];

/** UI views + internal modules (e.g. white_label in settings). */
export const MODULE_KEYS = [
  "overview",
  "conversations",
  "leads",
  "tickets",
  "quotes",
  "documents",
  "whatsapp",
  "automations",
  "analytics",
  "usage",
  "agent",
  "knowledge",
  "embed",
  "integrations",
  "subscription",
  "audit",
  "settings",
  "white_label",
  // Widget proactive messages (Phase 2 O). Internal: lives in the AI Agent view.
  "proactive_messages",
  // Google Calendar and Calendly sync for bookings (Phase 2 P). Internal: lives in Leads -> Bookings.
  "booking_sync",
  // Tenant websites and landing pages (Phase 2 Q).
  "sites",
  // Phase 1+ marketing hub. Reserved now so plans can gate them; each is
  // behind a feature flag that doesn't exist yet, so they stay off (and out
  // of every tenant's enabled modules) until a platform admin enables it.
  "social",
  "seo",
  "campaigns",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDef = {
  label: string;
  minPlan: PlanName;
  /** Optional platform feature flag — must be enabled when set. */
  flagKey?: string;
  /** Always available regardless of plan (billing, settings, dashboard). */
  alwaysEnabled?: boolean;
};

const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  business: 1,
  pro: 2,
  premium: 2,
  enterprise: 3,
};

export function planRank(plan: string): number {
  return PLAN_RANK[plan] ?? 0;
}

export function formatPlanLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export const MODULE_REGISTRY: Record<ModuleKey, ModuleDef> = {
  overview: { label: "Dashboard", minPlan: "free", alwaysEnabled: true },
  conversations: { label: "Conversations", minPlan: "free" },
  agent: { label: "AI Agent", minPlan: "free" },
  knowledge: { label: "Knowledge Base", minPlan: "free" },
  embed: { label: "Widget Embed", minPlan: "free" },
  usage: { label: "AI Usage", minPlan: "free" },
  subscription: { label: "Subscription", minPlan: "free", alwaysEnabled: true },
  settings: { label: "Settings", minPlan: "free", alwaysEnabled: true },
  leads: { label: "Leads", minPlan: "starter" },
  tickets: { label: "Support Tickets", minPlan: "starter" },
  audit: { label: "Audit Logs", minPlan: "starter" },
  analytics: { label: "Analytics", minPlan: "starter", flagKey: "advanced_analytics" },
  whatsapp: { label: "WhatsApp", minPlan: "starter", flagKey: "whatsapp_live" },
  quotes: { label: "Quotes & Proposals", minPlan: "pro" },
  documents: { label: "Document Assistant", minPlan: "pro", flagKey: "document_upload" },
  automations: { label: "Automations", minPlan: "pro", flagKey: "automations_engine" },
  integrations: { label: "Integrations", minPlan: "pro" },
  white_label: { label: "White Label", minPlan: "enterprise" },
  proactive_messages: { label: "Proactive messages", minPlan: "starter" },
  booking_sync: { label: "Calendar sync for bookings", minPlan: "pro" },
  sites: { label: "Website", minPlan: "starter", flagKey: "sites_builder" },
  social: { label: "Social Media", minPlan: "starter", flagKey: "social_hub" },
  seo: { label: "SEO & Search Visibility", minPlan: "pro", flagKey: "seo_hub" },
  campaigns: { label: "Campaigns", minPlan: "pro", flagKey: "campaigns_hub" },
};

/** Longest-prefix-first API path → module mapping. */
const API_MODULE_ROUTES: [string, ModuleKey][] = [
  ["/api/proposal-templates", "quotes"],
  ["/api/conversations", "conversations"],
  ["/api/knowledge-base", "knowledge"],
  ["/api/audit-logs", "audit"],
  ["/api/white-label", "white_label"],
  ["/api/automations", "automations"],
  ["/api/integrations", "integrations"],
  ["/api/connections", "integrations"],
  ["/api/social-accounts", "integrations"],
  ["/api/documents", "documents"],
  ["/api/analytics", "analytics"],
  ["/api/whatsapp", "whatsapp"],
  ["/api/tickets", "tickets"],
  ["/api/quotes", "quotes"],
  ["/api/leads", "leads"],
  ["/api/lead-forms", "leads"],
  ["/api/forms", "leads"],
  ["/api/bookings", "leads"],
  ["/api/booking-sync", "booking_sync"],
  ["/api/booking-types", "leads"],
  ["/api/site", "sites"],
  ["/api/content-posts", "social"],
  ["/api/scheduled-posts", "social"],
  ["/api/social-analytics", "social"],
  ["/api/usage", "usage"],
  ["/api/agent", "agent"],
  ["/api/widget-rules", "proactive_messages"],
  ["/api/team", "settings"],
  ["/api/gdpr", "settings"],
  ["/api/business", "settings"],
  ["/api/brand-profile", "settings"],
  ["/api/ai/score-lead", "leads"],
  ["/api/dashboard", "overview"],
  ["/api/onboarding", "overview"],
  ["/api/notifications", "overview"],
];

const MODULE_EXEMPT_PREFIXES = [
  "/api/auth/",
  "/api/subscription",
  "/api/payments/",
  "/api/invoices",
  "/api/feature-flags",
  "/api/announcements",
  "/api/health",
];

export function isModuleExemptApiPath(pathname: string): boolean {
  return MODULE_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

export function resolveModuleFromApiPath(pathname: string): ModuleKey | null {
  if (!pathname.startsWith("/api/")) return null;
  if (isModuleExemptApiPath(pathname)) return null;

  const sorted = [...API_MODULE_ROUTES].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, module] of sorted) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return module;
    }
  }
  return null;
}

/** ViewId aligns with ModuleKey for all dashboard nav items. */
export function viewToModule(view: string): ModuleKey | null {
  if (MODULE_KEYS.includes(view as ModuleKey)) {
    return view as ModuleKey;
  }
  return null;
}

export interface ModuleFlagUse {
  flagKey: string;
  module: ModuleKey;
  label: string;
  minPlan: string;
}

/** Every feature flag a module is gated on, for the platform console. */
export function listModuleFlags(): ModuleFlagUse[] {
  return (Object.entries(MODULE_REGISTRY) as [ModuleKey, ModuleDef][])
    .filter(([, def]) => !!def.flagKey)
    .map(([module, def]) => ({ flagKey: def.flagKey!, module, label: def.label, minPlan: def.minPlan }));
}
