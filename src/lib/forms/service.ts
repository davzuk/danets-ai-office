import "server-only";
import { Prisma, type LeadFormDef } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { LimitExceededError, requireQuota } from "@/lib/plan-quota";
import { createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";
import { captureInbound } from "@/lib/inbound-attribution";
import { leadSourceFromChannel } from "@/lib/attribution";
import { buildFormSchema, mapProfile, normalizeFields } from "./schema";

export interface Actor {
  businessId: string;
  userId: string;
  name: string;
}

/** Only absolute http(s) URLs: the hosted page and embed navigate to it. */
function safeRedirect(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

export interface FormSettings {
  submitLabel: string;
  successMessage: string;
  redirectUrl: string | null;
  consentText: string | null;
  leadQuality: "low" | "medium" | "high" | null;
}

/** Stored settings read back with defaults (older rows may miss keys). */
export function readSettings(raw: unknown): FormSettings {
  return sanitizeSettings(raw) as unknown as FormSettings;
}

function sanitizeSettings(raw: unknown): Prisma.InputJsonValue {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    submitLabel: typeof s.submitLabel === "string" ? s.submitLabel.slice(0, 80) : "Submit",
    successMessage: typeof s.successMessage === "string" ? s.successMessage.slice(0, 300) : "Thanks — we'll be in touch.",
    redirectUrl: safeRedirect(s.redirectUrl),
    consentText: typeof s.consentText === "string" && s.consentText.trim() ? s.consentText.trim().slice(0, 300) : null,
    leadQuality: s.leadQuality === "high" || s.leadQuality === "low" || s.leadQuality === "medium" ? s.leadQuality : null,
  };
}

/** Validate a name + fields payload (shared by create and update). */
export function validateFormInput(input: { name: unknown; fields: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120) throw new AppError("Give the form a name (up to 120 characters).", { status: 400, code: "INVALID_INPUT" });
  const { fields, problems } = normalizeFields(input.fields);
  if (problems.length || fields.length === 0) {
    throw new AppError(problems[0] || "Add at least one field.", { status: 400, code: "INVALID_FIELDS", details: { problems } });
  }
  return { name, fields };
}

export async function listForms(businessId: string) {
  return db.leadFormDef.findMany({
    where: { businessId },
    select: { id: true, name: true, status: true, submissions: true, createdAt: true, updatedAt: true, fields: true, settings: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createForm(a: Actor, input: { name: unknown; fields: unknown; settings?: unknown }) {
  const { name, fields } = validateFormInput(input);
  try {
    await requireQuota(a.businessId, "forms");
  } catch (e) {
    if (e instanceof LimitExceededError) throw new AppError("Form limit reached for this plan.", { status: 429, code: "LIMIT_EXCEEDED" });
    throw e;
  }
  return db.leadFormDef.create({
    data: {
      businessId: a.businessId,
      name,
      fields: fields as unknown as Prisma.InputJsonValue,
      settings: sanitizeSettings(input.settings),
    },
  });
}

export async function getForm(businessId: string, id: string) {
  const form = await db.leadFormDef.findFirst({ where: { id, businessId } });
  if (!form) throw new AppError("Form not found.", { status: 404, code: "NOT_FOUND" });
  return form;
}

export async function updateForm(businessId: string, id: string, input: { name?: unknown; fields?: unknown; settings?: unknown; status?: unknown }) {
  const form = await getForm(businessId, id);
  const data: Prisma.LeadFormDefUpdateInput = {};
  if (input.name !== undefined) data.name = validateFormInput({ name: input.name, fields: form.fields }).name;
  if (input.fields !== undefined) {
    const { fields } = validateFormInput({ name: form.name, fields: input.fields });
    data.fields = fields as unknown as Prisma.InputJsonValue;
  }
  if (input.settings !== undefined) data.settings = sanitizeSettings(input.settings);
  if (input.status === "active" || input.status === "archived") data.status = input.status;
  return db.leadFormDef.update({ where: { id: form.id }, data });
}

export async function archiveForm(businessId: string, id: string) {
  const form = await getForm(businessId, id);
  return db.leadFormDef.update({ where: { id: form.id }, data: { status: "archived" } });
}

/** A visitor's submission of a form. The route has already screened out spam. */
export async function submitForm(
  form: LeadFormDef,
  input: {
    answers: unknown;
    pageUrl?: string | null;
    ipHash?: string | null;
    attribution?: unknown;
    visitorId?: string | null;
    consent?: boolean;
    /** The lead magnet this form gated (workstream T). */
    leadMagnetId?: string | null;
  }
) {
  const { fields } = normalizeFields(form.fields);
  const schema = buildFormSchema(fields);
  const parsed = schema.safeParse(input.answers ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Check your answers.", { status: 400, code: "INVALID_INPUT" });
  }
  const answers = parsed.data as Record<string, unknown>;
  const settings = readSettings(form.settings);
  if (settings.consentText && !input.consent) {
    throw new AppError("Please tick the consent box to continue.", { status: 400, code: "CONSENT_REQUIRED" });
  }
  const profile = mapProfile(fields, answers);

  // A lead magnet's campaign wins over its gate form's (Phase 4 AA).
  const magnetCampaignId = input.leadMagnetId
    ? (await db.leadMagnet.findFirst({ where: { id: input.leadMagnetId, businessId: form.businessId }, select: { campaignId: true } }))?.campaignId
    : null;
  const inbound = await captureInbound({
    businessId: form.businessId,
    kind: "form_submit",
    visitorId: input.visitorId ?? null,
    attribution: input.attribution,
    campaignId: magnetCampaignId ?? form.campaignId,
    profile,
  });
  const contactId = inbound?.contactId ?? null;
  const email = typeof profile.email === "string" && profile.email.trim() ? profile.email.trim().toLowerCase() : null;

  let leadId: string | null = null;
  let alreadyExists = false;
  if (email) {
    const existing = await db.lead.findUnique({ where: { Lead_businessId_email_key: { businessId: form.businessId, email } } });
    if (existing) {
      leadId = existing.id;
      alreadyExists = true;
      if (contactId) await db.lead.updateMany({ where: { id: existing.id, contactId: null }, data: { contactId } });
    }
  }

  if (!leadId) {
    try {
      await requireQuota(form.businessId, "leads");
    } catch (e) {
      if (e instanceof LimitExceededError) throw new AppError("Lead capture limit reached for this business.", { status: 429, code: "LIMIT_EXCEEDED" });
      throw e;
    }
    try {
      const lead = await db.lead.create({
        data: {
          businessId: form.businessId,
          name: profile.name || email || "New lead",
          email,
          phone: profile.phone || null,
          company: profile.company?.trim() || null,
          service: profile.service || null,
          message: profile.message || null,
          quality: settings.leadQuality ?? (email ? "medium" : "low"),
          status: "new",
          source: inbound?.attributed ? leadSourceFromChannel(inbound.channel) : "form",
          contactId,
          firstTouchId: inbound?.firstTouch.id ?? null,
          lastTouchId: inbound?.touch.id ?? null,
        },
      });
      leadId = lead.id;
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002" && email) {
        const existing = await db.lead.findUnique({ where: { Lead_businessId_email_key: { businessId: form.businessId, email } } });
        if (existing) {
          leadId = existing.id;
          alreadyExists = true;
        } else throw e;
      } else throw e;
    }
  }

  const submission = await db.formSubmission.create({
    data: {
      businessId: form.businessId,
      formId: form.id,
      leadId,
      contactId,
      // The consent wording and time are kept with the answers (compliance).
      data: (settings.consentText ? { ...answers, _consent: { text: settings.consentText, at: new Date().toISOString() } } : answers) as unknown as Prisma.InputJsonValue,
      pageUrl: (input.pageUrl ?? "").slice(0, 2000) || null,
      ipHash: (input.ipHash ?? "").slice(0, 64) || null,
      status: "accepted",
      leadMagnetId: input.leadMagnetId ?? null,
    },
  });
  await db.leadFormDef.update({ where: { id: form.id }, data: { submissions: { increment: 1 } } });

  await createNotification({
    businessId: form.businessId,
    type: "form_submitted",
    title: "New form submission",
    message: `${form.name}: ${profile.name || email || "a visitor"} submitted the form`,
    data: { submissionId: submission.id, leadId: leadId ?? undefined, formId: form.id, leadMagnetId: input.leadMagnetId ?? undefined },
  });
  if (leadId) {
    await fireTrigger("form_submitted", { businessId: form.businessId, leadId, leadName: profile.name, formId: form.id, leadMagnetId: input.leadMagnetId ?? undefined });
  }

  return { submissionId: submission.id, leadId, alreadyExists, email, name: profile.name ?? null };
}

/**
 * Release a submission that was held as spam: run it through the normal
 * path (lead, contact, trigger) and drop the held copy. Fails if the
 * stored answers don't satisfy the form's current fields.
 */
export async function releaseSubmission(a: Actor, id: string) {
  const held = await db.formSubmission.findFirst({ where: { id, businessId: a.businessId } });
  if (!held) throw new AppError("Submission not found.", { status: 404, code: "NOT_FOUND" });
  if (held.status !== "spam") throw new AppError("Only submissions marked as spam can be released.", { status: 409, code: "NOT_SPAM" });
  const form = await getForm(a.businessId, held.formId);
  const { _consent, ...answers } = (held.data ?? {}) as Record<string, unknown>;
  const result = await submitForm(form, { answers, pageUrl: held.pageUrl, ipHash: held.ipHash, consent: true, leadMagnetId: held.leadMagnetId });
  await db.formSubmission.delete({ where: { id: held.id } });
  return { ...result, leadMagnetId: held.leadMagnetId };
}

export async function deleteSubmission(businessId: string, id: string) {
  const r = await db.formSubmission.deleteMany({ where: { id, businessId } });
  if (!r.count) throw new AppError("Submission not found.", { status: 404, code: "NOT_FOUND" });
}

export async function listSubmissions(businessId: string, formId: string, status: "accepted" | "spam" | "all" = "all") {
  await getForm(businessId, formId);
  const rows = await db.formSubmission.findMany({
    where: { formId, businessId, ...(status === "all" ? {} : { status }) },
    select: { id: true, leadId: true, contactId: true, data: true, pageUrl: true, status: true, spamScore: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
  const leads = leadIds.length ? await db.lead.findMany({ where: { id: { in: leadIds }, businessId }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(leads.map((l) => [l.id, l]));
  return rows.map((r) => ({ ...r, lead: r.leadId ? byId.get(r.leadId) ?? null : null }));
}
