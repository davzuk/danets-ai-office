// Page-level Graph API calls (webhook subscription) made with page tokens.

import { providerFetch } from "@/lib/connections/http";
import { META_PAGE_WEBHOOK_FIELDS, authed, graph } from "@/lib/connections/providers/meta";
import type { Env } from "@/lib/connections/types";

/** Subscribe our app to a Page's webhooks (leadgen, messages, feed, ...). */
export async function subscribePage(pageId: string, pageToken: string, env: Env = process.env) {
  await providerFetch<{ success: boolean }>(`${graph(env, `/${encodeURIComponent(pageId)}/subscribed_apps`)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: authed(env, pageToken, { subscribed_fields: META_PAGE_WEBHOOK_FIELDS.join(",") }),
  });
}

/** Remove our app's webhook subscription from a Page. */
export async function unsubscribePage(pageId: string, pageToken: string, env: Env = process.env) {
  await providerFetch<{ success: boolean }>(
    `${graph(env, `/${encodeURIComponent(pageId)}/subscribed_apps`)}?${authed(env, pageToken)}`,
    { method: "DELETE" }
  );
}

// ─── Lead Ads ──────────────────────────────────────────────────────────

export interface MetaLeadFieldDatum {
  name: string;
  values?: string[];
}

export interface MetaLeadData {
  id: string;
  created_time?: string;
  field_data?: MetaLeadFieldDatum[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  /** "fb" | "ig" (where the form was submitted) */
  platform?: string;
  is_organic?: boolean;
}

export interface MetaFormQuestion {
  key: string;
  label?: string;
  type?: string;
}

export interface MetaFormData {
  id: string;
  name?: string;
  status?: string;
  questions?: MetaFormQuestion[];
}

const LEAD_FIELDS =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic";
const FORM_FIELDS = "id,name,status,questions";

export async function fetchLead(leadgenId: string, pageToken: string, env: Env = process.env) {
  return providerFetch<MetaLeadData>(
    `${graph(env, `/${encodeURIComponent(leadgenId)}`)}?${authed(env, pageToken, { fields: LEAD_FIELDS })}`
  );
}

export async function fetchForm(formId: string, pageToken: string, env: Env = process.env) {
  return providerFetch<MetaFormData>(
    `${graph(env, `/${encodeURIComponent(formId)}`)}?${authed(env, pageToken, { fields: FORM_FIELDS })}`
  );
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

/** Follow `paging.next` up to `maxPages`. Next links already carry the token and proof. */
async function collect<T>(firstUrl: string, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  for (let i = 0; url && i < maxPages; i++) {
    const page: Paged<T> = await providerFetch<Paged<T>>(url);
    out.push(...(page.data ?? []));
    url = page.paging?.next;
  }
  return out;
}

export async function listPageForms(pageId: string, pageToken: string, env: Env = process.env) {
  return collect<MetaFormData>(
    `${graph(env, `/${encodeURIComponent(pageId)}/leadgen_forms`)}?${authed(env, pageToken, { fields: FORM_FIELDS, limit: "100" })}`,
    10
  );
}

/** Leads on a form created after `since` (Meta keeps 90 days). */
export async function listFormLeads(formId: string, pageToken: string, since: Date, env: Env = process.env) {
  const filtering = JSON.stringify([
    { field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) },
  ]);
  return collect<MetaLeadData>(
    `${graph(env, `/${encodeURIComponent(formId)}/leads`)}?${authed(env, pageToken, { fields: LEAD_FIELDS, filtering, limit: "100" })}`,
    50
  );
}
