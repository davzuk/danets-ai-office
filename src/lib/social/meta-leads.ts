// Meta Lead Ads → Lead. One import path for webhooks and the poller, made
// idempotent by Lead.externalRef = "meta:<leadgen_id>".

import type { Lead, MetaLeadForm, Prisma, SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";
import { recordTouch, type Channel } from "@/lib/attribution";
import { contactTouchBounds, normalizeEmail, normalizePhone, resolveContact } from "@/lib/contacts";
import { logger, serializeError } from "@/lib/logger";
import { requireQuota } from "@/lib/plan-quota";
import type { MetaFormData, MetaFormQuestion, MetaLeadData, MetaLeadFieldDatum } from "./meta-graph";

export const LEAD_FIELD_TARGETS = ["name", "email", "phone", "company", "service", "message", "ignore"] as const;
export type LeadFieldTarget = (typeof LEAD_FIELD_TARGETS)[number];
export type FieldMapping = Record<string, LeadFieldTarget>;

/** Meta's prefilled question keys. Anything else defaults to "message". */
const STANDARD_TARGETS: Record<string, LeadFieldTarget> = {
  full_name: "name",
  first_name: "name",
  last_name: "name",
  email: "email",
  work_email: "email",
  phone_number: "phone",
  work_phone_number: "phone",
  company_name: "company",
};

export function defaultTarget(key: string): LeadFieldTarget {
  return STANDARD_TARGETS[key] ?? "message";
}

export interface MappedLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  service: string | null;
  /** "Label: answer" lines for everything mapped to message. */
  message: string | null;
}

const MAX = { name: 191, company: 191, service: 191, message: 5000 };

/** Turn Meta's field_data into lead fields using the form's mapping. Pure. */
export function mapLeadFields(
  fieldData: MetaLeadFieldDatum[] | undefined,
  mapping: FieldMapping | null | undefined = {},
  questions: MetaFormQuestion[] | null | undefined = []
): MappedLead {
  const labels = new Map((questions ?? []).map((q) => [q.key, q.label || q.key]));
  const out = { name: [] as string[], email: [] as string[], phone: [] as string[], company: [] as string[], service: [] as string[], message: [] as string[] };
  let fullName: string | null = null;
  let first: string | null = null;
  let last: string | null = null;

  for (const f of fieldData ?? []) {
    const value = (f.values ?? []).map((v) => String(v).trim()).filter(Boolean).join(", ");
    if (!value) continue;
    const target = mapping?.[f.name] ?? defaultTarget(f.name);
    if (target === "ignore") continue;
    if (target === "name") {
      if (f.name === "first_name") first = value;
      else if (f.name === "last_name") last = value;
      else if (f.name === "full_name") fullName = value;
      else out.name.push(value);
      continue;
    }
    if (target === "message") {
      out.message.push(`${labels.get(f.name) ?? humanize(f.name)}: ${value}`);
      continue;
    }
    out[target].push(value);
  }

  const name = fullName ?? ([first, last].filter(Boolean).join(" ") || out.name[0] || null);
  return {
    name: name?.slice(0, MAX.name) ?? null,
    email: out.email.map((e) => normalizeEmail(e)).find(Boolean) ?? null,
    phone: out.phone.find((p) => normalizePhone(p)) ?? out.phone[0] ?? null,
    company: out.company[0]?.slice(0, MAX.company) ?? null,
    service: out.service.join(", ").slice(0, MAX.service) || null,
    message: out.message.join("\n").slice(0, MAX.message) || null,
  };
}

function humanize(key: string) {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function metaLeadRef(leadgenId: string) {
  return `meta:${leadgenId}`;
}

/** Attribution fields for the ad_lead touch. */
export function metaLeadTouch(lead: Pick<MetaLeadData, "is_organic" | "platform" | "campaign_name" | "adset_name" | "ad_name">) {
  const organic = lead.is_organic === true;
  const channel: Channel = organic ? "social_organic" : "social_paid";
  return {
    channel,
    touch: {
      source: lead.platform === "ig" ? "instagram" : "facebook",
      medium: organic ? "lead_form" : "paid_social",
      campaign: lead.campaign_name?.slice(0, 200) || null,
      term: lead.adset_name?.slice(0, 200) || null,
      content: lead.ad_name?.slice(0, 200) || null,
    },
  };
}

function quality(m: MappedLead): "low" | "medium" | "high" {
  const signals = [m.email, m.phone, m.service, m.message].filter(Boolean).length;
  if (signals >= 3 && (m.service || m.message)) return "high";
  if (signals <= 1) return "low";
  return "medium";
}

type FormRow = Pick<MetaLeadForm, "id" | "formId" | "name" | "enabled" | "fieldMapping" | "questions">;

/** Form row for a lead, creating it (enabled) from Meta's form metadata when first seen. */
export async function ensureLeadForm(account: Pick<SocialAccount, "id" | "businessId">, form: MetaFormData): Promise<MetaLeadForm> {
  const data = {
    name: (form.name || `Form ${form.id}`).slice(0, 191),
    metaStatus: form.status ?? null,
    questions: (form.questions ?? []).map((q) => ({ key: q.key, label: q.label ?? null, type: q.type ?? null })) as Prisma.InputJsonValue,
  };
  return db.metaLeadForm.upsert({
    where: { socialAccountId_formId: { socialAccountId: account.id, formId: form.id } },
    create: { businessId: account.businessId, socialAccountId: account.id, formId: form.id, ...data },
    update: data,
  });
}

export type ImportResult =
  | { status: "created"; lead: Lead }
  | { status: "duplicate"; leadId: string }
  | { status: "merged"; leadId: string }
  | { status: "skipped"; reason: string };

/**
 * Create the Lead for one Meta lead. Safe to call repeatedly with the same
 * lead: the externalRef unique index and the touch dedupe key make every
 * call after the first a no-op. Throws LimitExceededError when the plan's
 * lead quota is used up.
 */
export async function importMetaLead(
  account: Pick<SocialAccount, "id" | "businessId" | "name">,
  form: FormRow | null,
  data: MetaLeadData
): Promise<ImportResult> {
  if (form && !form.enabled) return { status: "skipped", reason: "form_disabled" };
  const businessId = account.businessId;
  const externalRef = metaLeadRef(data.id);

  const already = await db.lead.findUnique({ where: { businessId_externalRef: { businessId, externalRef } }, select: { id: true } });
  if (already) return { status: "duplicate", leadId: already.id };

  const mapped = mapLeadFields(data.field_data, form?.fieldMapping as FieldMapping | null, form?.questions as MetaFormQuestion[] | null);
  const occurredAt = data.created_time && !Number.isNaN(Date.parse(data.created_time)) ? new Date(data.created_time) : new Date();
  const { channel, touch } = metaLeadTouch(data);

  const resolved = await resolveContact({
    businessId,
    identities: [{ type: "meta_lead", value: data.id }],
    profile: { name: mapped.name, email: mapped.email, phone: mapped.phone, company: mapped.company },
    now: occurredAt,
  });
  const contactId = resolved?.contact.id ?? null;
  const adTouch = await recordTouch({
    businessId,
    kind: "ad_lead",
    channel,
    touch,
    contactId,
    occurredAt,
    dedupeKey: `meta-lead:${data.id}`,
  });
  const firstTouch = contactId ? ((await contactTouchBounds(contactId)).first ?? adTouch) : adTouch;

  // One lead per email per business: a known person submitting a form is a
  // new touch and an activity on their existing lead, not a second lead.
  if (mapped.email) {
    const existing = await db.lead.findUnique({
      where: { Lead_businessId_email_key: { businessId, email: mapped.email } },
      select: { id: true, contactId: true },
    });
    if (existing) {
      await noteRepeatSubmission(existing.id, businessId, contactId, adTouch.id, form, data);
      return { status: "merged", leadId: existing.id };
    }
  }

  await requireQuota(businessId, "leads");

  let lead: Lead;
  try {
    lead = await db.lead.create({
      data: {
        businessId,
        name: mapped.name || mapped.email || mapped.phone || "Meta lead",
        email: mapped.email,
        phone: mapped.phone,
        company: mapped.company,
        service: mapped.service ?? (form?.name.slice(0, 191) || null),
        message: mapped.message,
        quality: quality(mapped),
        status: "new",
        source: firstTouch.channel,
        contactId,
        firstTouchId: firstTouch.id,
        lastTouchId: adTouch.id,
        externalRef,
        createdAt: occurredAt,
      },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      // Raced with another worker on the same lead or email.
      const winner = await db.lead.findFirst({
        where: { businessId, OR: [{ externalRef }, ...(mapped.email ? [{ email: mapped.email }] : [])] },
        select: { id: true, externalRef: true },
      });
      if (winner?.externalRef === externalRef) return { status: "duplicate", leadId: winner.id };
      if (winner) {
        await noteRepeatSubmission(winner.id, businessId, contactId, adTouch.id, form, data);
        return { status: "merged", leadId: winner.id };
      }
    }
    throw e;
  }

  await db.leadActivity.create({
    data: {
      leadId: lead.id,
      businessId,
      type: "lead_created",
      description: `Captured from Meta lead form "${form?.name ?? data.form_id ?? "unknown"}" on ${account.name}`,
      metadata: JSON.stringify({ leadgenId: data.id, formId: data.form_id, adName: data.ad_name, campaignName: data.campaign_name }),
    },
  });
  if (form) {
    await db.metaLeadForm.update({
      where: { id: form.id },
      data: { leadsImported: { increment: 1 }, lastLeadAt: occurredAt },
    });
  }
  await afterLeadCreated(lead);
  return { status: "created", lead };
}

async function noteRepeatSubmission(
  leadId: string,
  businessId: string,
  contactId: string | null,
  touchId: string,
  form: FormRow | null,
  data: MetaLeadData
) {
  await db.lead.update({
    where: { id: leadId },
    data: { lastTouchId: touchId, ...(contactId ? { contactId } : {}) },
  });
  await db.leadActivity.create({
    data: {
      leadId,
      businessId,
      type: "lead_updated",
      description: `Submitted Meta lead form "${form?.name ?? data.form_id ?? "unknown"}" again`,
      metadata: JSON.stringify({ leadgenId: data.id, formId: data.form_id, adName: data.ad_name }),
    },
  });
}

async function afterLeadCreated(lead: Lead) {
  const high = lead.quality === "high";
  await createNotification({
    businessId: lead.businessId,
    type: high ? "high_quality_lead" : "new_lead",
    title: high ? "High quality lead from Meta Lead Ads" : "New lead from Meta Lead Ads",
    message: `${lead.name}${lead.service ? ` — ${lead.service}` : ""} (${lead.quality} quality)`,
    data: { leadId: lead.id, quality: lead.quality, source: lead.source },
  });
  await fireTrigger("new_lead", { businessId: lead.businessId, leadId: lead.id, leadName: lead.name });
  try {
    const { scoreLead } = await import("@/lib/ai-scoring");
    await scoreLead(lead.id, lead.businessId);
  } catch (e) {
    logger.warn("Lead scoring failed for Meta lead", { leadId: lead.id, ...serializeError(e) });
  }
}
