import "server-only";
import type { LeadFormDef } from "@prisma/client";
import { db } from "@/lib/db";
import { isModuleEnabled } from "@/lib/module-access";
import { normalizeFields, type FormField } from "./schema";
import { readSettings } from "./service";

/** What a visitor's browser gets: no field mapping, no internal settings. */
export interface PublicForm {
  id: string;
  name: string;
  businessName: string;
  brandColor: string | null;
  fields: Omit<FormField, "mapTo">[];
  submitLabel: string;
  successMessage: string;
  redirectUrl: string | null;
  consentText: string | null;
}

export interface LoadedForm {
  form: LeadFormDef;
  business: { id: string; name: string; widgetAllowedOrigins: unknown };
  public: PublicForm;
}

/**
 * A form a visitor may see and submit: active, on an active business that
 * has the Leads module. Null otherwise (callers answer 404).
 */
export async function loadPublicForm(id: string): Promise<LoadedForm | null> {
  if (!id || id.length > 40) return null;
  const form = await db.leadFormDef.findUnique({ where: { id } });
  if (!form || form.status !== "active") return null;
  const business = await db.business.findUnique({
    where: { id: form.businessId },
    select: { id: true, name: true, status: true, plan: true, widgetAllowedOrigins: true },
  });
  if (!business || business.status !== "active") return null;
  if (!(await isModuleEnabled(business.id, "leads", business.plan))) return null;

  const agent = await db.aiAgent.findFirst({ where: { businessId: business.id }, select: { brandColor: true }, orderBy: { createdAt: "asc" } });
  const settings = readSettings(form.settings);
  const { fields } = normalizeFields(form.fields);
  return {
    form,
    business: { id: business.id, name: business.name, widgetAllowedOrigins: business.widgetAllowedOrigins },
    public: {
      id: form.id,
      name: form.name,
      businessName: business.name,
      brandColor: agent?.brandColor ?? null,
      fields: fields.map(({ mapTo: _mapTo, ...f }) => f),
      submitLabel: settings.submitLabel,
      successMessage: settings.successMessage,
      redirectUrl: settings.redirectUrl,
      consentText: settings.consentText,
    },
  };
}
