import { db } from "@/lib/db";
import { getCachedQuotaUsage, getCachedEffectiveLimits } from "@/lib/quota-cache";

export type QuotaResource =
  | "leads"
  | "kbItems"
  | "agents"
  | "chats"
  | "aiRequests"
  | "tickets"
  | "documents"
  | "automations"
  | "seats"
  | "whatsappTemplates"
  | "integrations"
  | "proposalTemplates"
  | "quotes"
  | "bookingTypes"
  | "pages"
  | "forms"
  | "leadMagnets"
  | "seoProperties"
  | "gbpLocations"
  | "mediaStorageMb";

export interface EffectiveLimits {
  plan: string;
  hasOverride: boolean;
  chatLimit: number;
  leadLimit: number;
  kbLimit: number;
  agentLimit: number;
  aiLimit: number;
  ticketLimit: number;
  documentLimit: number;
  automationLimit: number;
  seatLimit: number;
  whatsappTemplateLimit: number;
  integrationLimit: number;
  proposalTemplateLimit: number;
  quoteLimit: number;
  bookingTypeLimit: number;
  pageLimit: number;
  formLimit: number;
  leadMagnetLimit: number;
  seoPropertyLimit: number;
  gbpLocationLimit: number;
  auditPageLimit: number;
  trackedKeywordLimit: number;
  mediaStorageMbLimit: number;
}

export interface QuotaUsage {
  chats: number;
  leads: number;
  kbItems: number;
  agents: number;
  aiRequests: number;
  tickets: number;
  documents: number;
  automations: number;
  seats: number;
  whatsappTemplates: number;
  integrations: number;
  proposalTemplates: number;
  quotes: number;
  bookingTypes: number;
  pages: number;
  forms: number;
  leadMagnets: number;
  seoProperties: number;
  gbpLocations: number;
  /** Media library size in MB (rounded up). */
  mediaStorageMb: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resource: QuotaResource;
}

const FALLBACK_AGENT_LIMITS: Record<string, number> = {
  free: 1,
  starter: 3,
  business: 3,
  pro: 999,
  premium: 999,
  enterprise: 9999,
};

export const RESOURCE_LABELS: Record<QuotaResource, string> = {
  leads: "monthly leads",
  kbItems: "knowledge base items",
  agents: "AI agents",
  chats: "monthly chats",
  aiRequests: "monthly AI requests",
  tickets: "support tickets",
  documents: "documents",
  automations: "automation workflows",
  seats: "team members",
  whatsappTemplates: "WhatsApp templates",
  integrations: "integrations",
  proposalTemplates: "proposal templates",
  quotes: "monthly quotes",
  bookingTypes: "booking types",
  pages: "published website pages",
  forms: "lead capture forms",
  leadMagnets: "lead magnets",
  seoProperties: "Search Console properties",
  gbpLocations: "Business Profile locations",
  mediaStorageMb: "MB of media storage",
};

export class LimitExceededError extends Error {
  readonly resource: QuotaResource;
  readonly limit: number;
  readonly used: number;

  constructor(resource: QuotaResource, limit: number, used: number) {
    super(`LIMIT_EXCEEDED:${resource}:${limit}`);
    this.resource = resource;
    this.limit = limit;
    this.used = used;
  }

  get label() {
    return RESOURCE_LABELS[this.resource];
  }
}

function startOfMonth() {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

export async function getEffectiveLimits(
  businessId: string,
  planName?: string
): Promise<EffectiveLimits> {
  // Per-request memoization — same (businessId, planName) within one
  // request reuses the result instead of re-hitting the DB. See
  // `lib/quota-cache.ts` for the rationale.
  return getCachedEffectiveLimits(businessId, planName, async () => {
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { plan: true, limitOverride: true },
    });

    const plan = planName || business?.plan || "free";
    const planRow = await db.subscriptionPlan.findUnique({ where: { name: plan } });
    const override = business?.limitOverride;

    const baseChat = planRow?.chatLimit ?? 100;
    const base = {
      chatLimit: baseChat,
      leadLimit: planRow?.leadLimit ?? 50,
      kbLimit: planRow?.kbLimit ?? 25,
      agentLimit: planRow?.agentLimit ?? FALLBACK_AGENT_LIMITS[plan] ?? 1,
      ticketLimit: planRow?.ticketLimit ?? 100,
      documentLimit: planRow?.documentLimit ?? 25,
      automationLimit: planRow?.automationLimit ?? 5,
      seatLimit: planRow?.seatLimit ?? 3,
      whatsappTemplateLimit: planRow?.whatsappTemplateLimit ?? 5,
      integrationLimit: planRow?.integrationLimit ?? 3,
      proposalTemplateLimit: planRow?.proposalTemplateLimit ?? 10,
      quoteLimit: planRow?.quoteLimit ?? 50,
      bookingTypeLimit: planRow?.bookingTypeLimit ?? 3,
      pageLimit: planRow?.pageLimit ?? 3,
      formLimit: planRow?.formLimit ?? 3,
      leadMagnetLimit: planRow?.leadMagnetLimit ?? 3,
      seoPropertyLimit: planRow?.seoPropertyLimit ?? 1,
      gbpLocationLimit: planRow?.gbpLocationLimit ?? 1,
      auditPageLimit: planRow?.auditPageLimit ?? 200,
      trackedKeywordLimit: planRow?.trackedKeywordLimit ?? 50,
      mediaStorageMbLimit: planRow?.mediaStorageMbLimit ?? 1024,
    };

    return {
      plan,
      hasOverride: !!override,
      chatLimit: override?.chatLimit ?? base.chatLimit,
      leadLimit: override?.leadLimit ?? base.leadLimit,
      kbLimit: override?.kbLimit ?? base.kbLimit,
      agentLimit: override?.agentLimit ?? base.agentLimit,
      aiLimit: override?.chatLimit ?? base.chatLimit,
      ticketLimit: override?.ticketLimit ?? base.ticketLimit,
      documentLimit: override?.documentLimit ?? base.documentLimit,
      automationLimit: override?.automationLimit ?? base.automationLimit,
      seatLimit: override?.seatLimit ?? base.seatLimit,
      whatsappTemplateLimit:
        override?.whatsappTemplateLimit ?? base.whatsappTemplateLimit,
      integrationLimit: override?.integrationLimit ?? base.integrationLimit,
      proposalTemplateLimit:
        override?.proposalTemplateLimit ?? base.proposalTemplateLimit,
      quoteLimit: override?.quoteLimit ?? base.quoteLimit,
      bookingTypeLimit: override?.bookingTypeLimit ?? base.bookingTypeLimit,
      pageLimit: override?.pageLimit ?? base.pageLimit,
      formLimit: override?.formLimit ?? base.formLimit,
      leadMagnetLimit: override?.leadMagnetLimit ?? base.leadMagnetLimit,
      seoPropertyLimit: override?.seoPropertyLimit ?? base.seoPropertyLimit,
      gbpLocationLimit: override?.gbpLocationLimit ?? base.gbpLocationLimit,
      auditPageLimit: override?.auditPageLimit ?? base.auditPageLimit,
      trackedKeywordLimit: override?.trackedKeywordLimit ?? base.trackedKeywordLimit,
      mediaStorageMbLimit: override?.mediaStorageMbLimit ?? base.mediaStorageMbLimit,
    };
  });
}

export async function getQuotaUsage(businessId: string): Promise<QuotaUsage> {
  // Per-request memoization — wraps the 13-count parallel query below
  // so repeated calls within a single request don't re-hit the DB.
  return getCachedQuotaUsage(businessId, async () => {
  const monthStart = startOfMonth();
  const [
    chats,
    leads,
    kbItems,
    agents,
    aiRequests,
    tickets,
    documents,
    automations,
    seats,
    whatsappTemplates,
    integrations,
    proposalTemplates,
    quotes,
    bookingTypes,
    pages,
    forms,
    leadMagnets,
    seoProperties,
    gbpLocations,
    media,
  ] = await Promise.all([
    db.chatSession.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.lead.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.knowledgeBaseItem.count({ where: { businessId } }),
    db.aiAgent.count({ where: { businessId } }),
    db.aiUsageLog.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.supportTicket.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.document.count({ where: { businessId } }),
    db.automationWorkflow.count({ where: { businessId } }),
    db.businessUser.count({ where: { businessId } }),
    db.whatsAppTemplate.count({ where: { businessId } }),
    db.integration.count({ where: { businessId } }),
    db.proposalTemplate.count({ where: { businessId } }),
    db.quoteRequest.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.bookingType.count({ where: { businessId } }),
    db.landingPage.count({ where: { businessId, status: "published" } }),
    db.leadFormDef.count({ where: { businessId } }),
    db.leadMagnet.count({ where: { businessId } }),
    db.searchProperty.count({ where: { businessId } }),
    db.businessLocation.count({ where: { businessId } }),
    db.mediaAsset.aggregate({ where: { businessId }, _sum: { sizeBytes: true } }),
  ]);

  return {
    chats,
    leads,
    kbItems,
    agents,
    aiRequests,
    tickets,
    documents,
    automations,
    seats,
    whatsappTemplates,
    integrations,
    proposalTemplates,
    quotes,
    bookingTypes,
    pages,
    forms,
    leadMagnets,
    seoProperties,
    gbpLocations,
    mediaStorageMb: Math.ceil((media._sum.sizeBytes ?? 0) / (1024 * 1024)),
  };
  });
}

function limitForResource(
  limits: EffectiveLimits,
  resource: QuotaResource
): number {
  switch (resource) {
    case "leads":
      return limits.leadLimit;
    case "kbItems":
      return limits.kbLimit;
    case "agents":
      return limits.agentLimit;
    case "chats":
      return limits.chatLimit;
    case "aiRequests":
      return limits.aiLimit;
    case "tickets":
      return limits.ticketLimit;
    case "documents":
      return limits.documentLimit;
    case "automations":
      return limits.automationLimit;
    case "seats":
      return limits.seatLimit;
    case "whatsappTemplates":
      return limits.whatsappTemplateLimit;
    case "integrations":
      return limits.integrationLimit;
    case "proposalTemplates":
      return limits.proposalTemplateLimit;
    case "quotes":
      return limits.quoteLimit;
    case "bookingTypes":
      return limits.bookingTypeLimit;
    case "pages":
      return limits.pageLimit;
    case "forms":
      return limits.formLimit;
    case "leadMagnets":
      return limits.leadMagnetLimit;
    case "seoProperties":
      return limits.seoPropertyLimit;
    case "gbpLocations":
      return limits.gbpLocationLimit;
    case "mediaStorageMb":
      return limits.mediaStorageMbLimit;
  }
}

function usedForResource(
  usage: QuotaUsage,
  resource: QuotaResource
): number {
  switch (resource) {
    case "leads":
      return usage.leads;
    case "kbItems":
      return usage.kbItems;
    case "agents":
      return usage.agents;
    case "chats":
      return usage.chats;
    case "aiRequests":
      return usage.aiRequests;
    case "tickets":
      return usage.tickets;
    case "documents":
      return usage.documents;
    case "automations":
      return usage.automations;
    case "seats":
      return usage.seats;
    case "whatsappTemplates":
      return usage.whatsappTemplates;
    case "integrations":
      return usage.integrations;
    case "proposalTemplates":
      return usage.proposalTemplates;
    case "quotes":
      return usage.quotes;
    case "bookingTypes":
      return usage.bookingTypes;
    case "pages":
      return usage.pages;
    case "forms":
      return usage.forms;
    case "leadMagnets":
      return usage.leadMagnets;
    case "seoProperties":
      return usage.seoProperties;
    case "gbpLocations":
      return usage.gbpLocations;
    case "mediaStorageMb":
      return usage.mediaStorageMb;
  }
}

export async function checkQuota(
  businessId: string,
  resource: QuotaResource,
  additionalCount = 1
): Promise<QuotaCheckResult> {
  const limits = await getEffectiveLimits(businessId);
  const usage = await getQuotaUsage(businessId);
  const limit = limitForResource(limits, resource);
  const used = usedForResource(usage, resource);

  // 0 or negative limit = unlimited
  if (limit <= 0) {
    return { allowed: true, used, limit, remaining: Infinity, resource };
  }

  const remaining = Math.max(0, limit - used);
  const allowed = used + additionalCount <= limit;

  return { allowed, used, limit, remaining, resource };
}

export async function requireQuota(
  businessId: string,
  resource: QuotaResource,
  additionalCount = 1
): Promise<QuotaCheckResult> {
  const result = await checkQuota(businessId, resource, additionalCount);
  if (!result.allowed) {
    throw new LimitExceededError(resource, result.limit, result.used);
  }
  return result;
}

export function formatLimitExceededMessage(err: LimitExceededError): string {
  return `You have reached your plan limit for ${err.label} (${err.used.toLocaleString()} / ${err.limit.toLocaleString()}). Please upgrade your plan.`;
}
