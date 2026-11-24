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

function sanitizeSettings(raw: unknown): Prisma.InputJsonValue {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    submitLabel: typeof s.submitLabel === "string" ? s.submitLabel.slice(0, 80) : "Submit",
    successMessage: typeof s.successMessage === "string" ? s.successMessage.slice(0, 300) : "Thanks — we'll be in touch.",
    redirectUrl: typeof s.redirectUrl === "string" ? s.redirectUrl.slice(0, 500) : null,
    consentText: typeof s.consentText === "string" ? s.consentText.slice(0, 300) : null,
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

export async function updateForm(businessId: string, id: string, input: { name?: unknown; fields?: unknown; settings?: unknown }) {
  const form = await getForm(businessId, id);
  const data: Prisma.LeadFormDefUpdateInput = {};
  if (input.name !== undefined) data.name = validateFormInput({ name: input.name, fields: form.fields }).name;
  if (input.fields !== undefined) {
    const { fields } = validateFormInput({ name: form.name, fields: input.fields });
    data.fields = fields as unknown as Prisma.InputJsonValue;
  }
  if (input.settings !== undefined) data.settings = sanitizeSettings(input.settings);
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
  }
) {
  const { fields } = normalizeFields(form.fields);
  const schema = buildFormSchema(fields);
  const parsed = schema.safeParse(input.answers ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Check your answers.", { status: 400, code: "INVALID_INPUT" });
  }
  const answers = parsed.data as Record<string, unknown>;
  const profile = mapProfile(fields, answers);

  const inbound = await captureInbound({
    businessId: form.businessId,
    kind: "form_submit",
    visitorId: input.visitorId ?? null,
    attribution: input.attribution,
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
    const settings = (form.settings ?? {}) as { leadQuality?: "low" | "medium" | "high" };
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
      data: answers as unknown as Prisma.InputJsonValue,
      pageUrl: (input.pageUrl ?? "").slice(0, 2000) || null,
      ipHash: (input.ipHash ?? "").slice(0, 64) || null,
      status: "accepted",
    },
  });
  await db.leadFormDef.update({ where: { id: form.id }, data: { submissions: { increment: 1 } } });

  await createNotification({
    businessId: form.businessId,
    type: "form_submitted",
    title: "New form submission",
    message: `${form.name}: ${profile.name || email || "a visitor"} submitted the form`,
    data: { submissionId: submission.id, leadId: leadId ?? undefined, formId: form.id },
  });
  if (leadId) {
    await fireTrigger("form_submitted", { businessId: form.businessId, leadId, leadName: profile.name, formId: form.id });
  }

  return { submissionId: submission.id, leadId, alreadyExists };
}