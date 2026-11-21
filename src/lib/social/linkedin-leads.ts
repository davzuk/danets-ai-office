// LinkedIn Lead Gen Forms → Lead, through the same import as Meta lead ads
// (src/lib/social/meta-leads.ts). Lead.externalRef = "linkedin:<response id>".
// Form rows reuse MetaLeadForm (one per LinkedIn form, keyed by the Page).

import { orgUrn } from "@/lib/connections/providers/linkedin";
import type { LinkedInClient } from "@/lib/social/publish/linkedin";
import type { AdLeadInput } from "./meta-leads";
import type { MetaFormData, MetaLeadFieldDatum } from "./meta-graph";

/** Lead types polled: ad forms. Organic Page forms can be added here once used. */
export const LINKEDIN_LEAD_TYPES = ["SPONSORED"] as const;

export interface LinkedInAnswer {
  questionId?: number | string;
  answerDetails?: {
    textQuestionAnswer?: { answer?: string };
    multipleChoiceAnswer?: { options?: (number | string)[] };
  };
}

export interface LinkedInLeadResponse {
  id: string;
  owner?: Record<string, string>;
  submittedAt?: number;
  leadType?: string;
  testLead?: boolean;
  versionedLeadGenFormUrn?: string;
  formResponse?: { answers?: LinkedInAnswer[]; hiddenFields?: { name?: string; value?: string }[] };
  leadMetadata?: { sponsoredLeadMetadata?: { campaign?: string } };
  [k: string]: unknown;
}

export interface LinkedInFormQuestion {
  questionId?: number | string;
  name?: string;
  predefinedField?: string;
  question?: { localized?: Record<string, string> };
  questionDetails?: { multipleChoiceQuestionDetails?: { options?: { id?: number | string; text?: { localized?: Record<string, string> } }[] } };
}

export interface LinkedInForm {
  id?: number | string;
  name?: string;
  state?: string;
  content?: { questions?: LinkedInFormQuestion[] };
}

const localized = (l?: Record<string, string>) => (l ? (l.en_US ?? Object.values(l)[0]) : undefined);

/** "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,4)" → "123". */
export function formIdFromVersionedUrn(urn: string | undefined): string | null {
  const m = urn ? /leadGenForm:(\d+)/.exec(urn) : null;
  return m ? m[1] : null;
}

/** Question key used for field mapping: the predefined field when there is one ("email"), else "q_<id>". */
export function questionKey(q: Pick<LinkedInFormQuestion, "questionId" | "predefinedField">): string {
  return q.predefinedField ? q.predefinedField.toLowerCase() : `q_${q.questionId}`;
}

/** LinkedIn form metadata in the shape the lead-form rows store. */
export function toFormData(formId: string, form: LinkedInForm | null): MetaFormData {
  return {
    id: formId,
    name: form?.name || `LinkedIn form ${formId}`,
    status: form?.state,
    questions: (form?.content?.questions ?? []).map((q) => ({
      key: questionKey(q),
      label: localized(q.question?.localized) ?? q.name ?? questionKey(q),
      type: q.predefinedField ? "PREDEFINED" : "CUSTOM",
    })),
  };
}

/** Answers as Meta-style field_data, so the shared mapping applies. Pure. */
export function linkedinFieldData(lead: LinkedInLeadResponse, form: LinkedInForm | null): MetaLeadFieldDatum[] {
  const questions = new Map((form?.content?.questions ?? []).map((q) => [String(q.questionId), q]));
  const out: MetaLeadFieldDatum[] = [];
  for (const a of lead.formResponse?.answers ?? []) {
    const q = questions.get(String(a.questionId));
    const key = q ? questionKey(q) : `q_${a.questionId}`;
    const text = a.answerDetails?.textQuestionAnswer?.answer;
    if (text) {
      out.push({ name: key, values: [text] });
      continue;
    }
    const picked = a.answerDetails?.multipleChoiceAnswer?.options ?? [];
    if (picked.length) {
      const opts = new Map((q?.questionDetails?.multipleChoiceQuestionDetails?.options ?? []).map((o) => [String(o.id), localized(o.text?.localized)]));
      out.push({ name: key, values: picked.map((p) => opts.get(String(p)) ?? String(p)) });
    }
  }
  return out;
}

/** LinkedIn's first-party click id, when the form passed it as a hidden field. */
export function findLiFatId(lead: LinkedInLeadResponse): string | null {
  for (const h of lead.formResponse?.hiddenFields ?? []) {
    if (h.name?.toLowerCase() === "li_fat_id" && h.value) return h.value.slice(0, 500);
  }
  return null;
}

export function linkedinLeadRef(id: string) {
  return `linkedin:${id}`;
}

/** Everything the shared import needs for one LinkedIn lead. Pure. */
export function linkedinLeadInput(lead: LinkedInLeadResponse, form: LinkedInForm | null): AdLeadInput {
  const clickId = findLiFatId(lead);
  const campaign = lead.leadMetadata?.sponsoredLeadMetadata?.campaign?.replace(/^urn:li:sponsoredCampaign:/, "") ?? null;
  const formId = formIdFromVersionedUrn(lead.versionedLeadGenFormUrn);
  const sponsored = (lead.leadType ?? "SPONSORED") === "SPONSORED";
  return {
    id: lead.id,
    externalRef: linkedinLeadRef(lead.id),
    identityType: "linkedin_lead",
    touchKey: `linkedin-lead:${lead.id}`,
    fieldData: linkedinFieldData(lead, form),
    occurredAt: lead.submittedAt ? new Date(lead.submittedAt) : new Date(),
    channel: sponsored ? "social_paid" : "social_organic",
    touch: {
      source: "linkedin",
      medium: sponsored ? "paid_social" : "lead_form",
      campaign: campaign ? `linkedin-campaign-${campaign}` : null,
      ...(clickId ? { clickId, clickIdType: "li_fat_id" as const } : {}),
    },
    network: "LinkedIn",
    formRef: formId,
    metadata: { linkedinLeadId: lead.id, formId, campaign, testLead: lead.testLead === true },
  };
}

// ─── API calls ─────────────────────────────────────────────────────────

/** Lead responses for one Page submitted in [since, until). */
export async function listLeadResponses(client: LinkedInClient, organizationId: string, since: Date, until: Date, leadType: string) {
  const owner = `(organization:${encodeURIComponent(orgUrn(organizationId))})`;
  const out: LinkedInLeadResponse[] = [];
  let start = 0;
  for (let page = 0; page < 50; page++) {
    const r = await client.json<{ elements?: LinkedInLeadResponse[]; paging?: { total?: number } }>(
      "GET",
      `/leadFormResponses?q=owner&owner=${owner}&leadType=(leadType:${leadType})&limitedToTestLeads=false` +
        `&submittedAtTimeRange=(start:${since.getTime()},end:${until.getTime()})&start=${start}&count=100`
    );
    const els = r.data.elements ?? [];
    out.push(...els);
    start += els.length;
    if (els.length < 100 || (r.data.paging?.total !== undefined && start >= r.data.paging.total)) break;
  }
  return out;
}

export async function fetchLinkedInForm(client: LinkedInClient, formId: string): Promise<LinkedInForm | null> {
  try {
    return (await client.json<LinkedInForm>("GET", `/leadForms/${encodeURIComponent(formId)}`)).data;
  } catch {
    return null; // answers still import, labelled by question id
  }
}

