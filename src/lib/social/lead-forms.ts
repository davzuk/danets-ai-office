// Client-safe view and validation for Meta lead forms.

import type { MetaLeadForm, SocialAccount } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { metaLeadgenPollJob } from "@/lib/jobs/handlers/meta-leadgen";
import type { MetaFormQuestion } from "./meta-graph";
import { LEAD_FIELD_TARGETS, defaultTarget, type FieldMapping, type LeadFieldTarget } from "./meta-leads";

export interface PublicLeadForm {
  id: string;
  socialAccountId: string;
  accountName: string;
  formId: string;
  name: string;
  metaStatus: string | null;
  enabled: boolean;
  questions: { key: string; label: string; type: string | null; target: LeadFieldTarget }[];
  leadsImported: number;
  lastLeadAt: string | null;
  polledThrough: string | null;
}

export function toPublicLeadForm(row: MetaLeadForm & { socialAccount: Pick<SocialAccount, "name"> }): PublicLeadForm {
  const mapping = (row.fieldMapping ?? {}) as FieldMapping;
  const questions = ((row.questions ?? []) as unknown as MetaFormQuestion[]).map((q) => ({
    key: q.key,
    label: q.label || q.key,
    type: q.type ?? null,
    target: mapping[q.key] ?? defaultTarget(q.key),
  }));
  return {
    id: row.id,
    socialAccountId: row.socialAccountId,
    accountName: row.socialAccount.name,
    formId: row.formId,
    name: row.name,
    metaStatus: row.metaStatus,
    enabled: row.enabled,
    questions,
    leadsImported: row.leadsImported,
    lastLeadAt: row.lastLeadAt?.toISOString() ?? null,
    polledThrough: row.polledThrough?.toISOString() ?? null,
  };
}

export const leadFormPatchSchema = z
  .object({
    enabled: z.boolean(),
    fieldMapping: z.record(z.string().max(191), z.enum(LEAD_FIELD_TARGETS)),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

/** Queue a poll (and first-time 90-day backfill) for one Page. Coalesced per 5 minutes. */
export async function queueLeadSync(account: Pick<SocialAccount, "id" | "businessId">) {
  const bucket = Math.floor(Date.now() / (5 * 60_000));
  return enqueue(
    metaLeadgenPollJob,
    { socialAccountId: account.id },
    { businessId: account.businessId, dedupeKey: `meta-leadgen-poll:${account.id}:${bucket}` }
  );
}

export async function listLeadForms(businessId: string) {
  const rows = await db.metaLeadForm.findMany({
    where: { businessId },
    include: { socialAccount: { select: { name: true } } },
    orderBy: [{ lastLeadAt: "desc" }, { name: "asc" }],
  });
  return rows.map(toPublicLeadForm);
}
