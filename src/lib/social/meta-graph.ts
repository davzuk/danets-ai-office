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

// ─── Messaging & comments (social inbox) ───────────────────────────────

export interface MessagingProfile {
  name: string | null;
  username: string | null;
}

/** Name of a Messenger (PSID) or Instagram (IGSID) user. Best effort: null on failure. */
export async function fetchMessagingProfile(
  userId: string,
  pageToken: string,
  platform: "facebook_page" | "instagram",
  env: Env = process.env
): Promise<MessagingProfile | null> {
  const fields = platform === "instagram" ? "name,username" : "first_name,last_name,name";
  try {
    const p = await providerFetch<{ name?: string; first_name?: string; last_name?: string; username?: string }>(
      `${graph(env, `/${encodeURIComponent(userId)}`)}?${authed(env, pageToken, { fields })}`
    );
    const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
    return { name, username: p.username ?? null };
  } catch {
    return null;
  }
}

export type SendRecipient = { id: string } | { comment_id: string };

/**
 * Send a Messenger / Instagram message as the Page. `tag: "HUMAN_AGENT"`
 * extends the reply window to 7 days for replies typed by a person.
 */
export async function sendPageMessage(
  pageToken: string,
  recipient: SendRecipient,
  text: string,
  opts: { tag?: "HUMAN_AGENT" } = {},
  env: Env = process.env
) {
  const body = authed(env, pageToken, {
    recipient: JSON.stringify(recipient),
    message: JSON.stringify({ text }),
    messaging_type: opts.tag ? "MESSAGE_TAG" : "RESPONSE",
    ...(opts.tag ? { tag: opts.tag } : {}),
  });
  return providerFetch<{ recipient_id?: string; message_id: string }>(graph(env, "/me/messages"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

/** Public reply under a comment. Facebook: /{id}/comments; Instagram: /{id}/replies. */
export async function replyToComment(
  commentId: string,
  pageToken: string,
  text: string,
  platform: "facebook_page" | "instagram",
  env: Env = process.env
) {
  const edge = platform === "instagram" ? "replies" : "comments";
  return providerFetch<{ id: string }>(graph(env, `/${encodeURIComponent(commentId)}/${edge}`), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: authed(env, pageToken, { message: text }),
  });
}

/** Hide (or unhide) a comment. Facebook uses is_hidden, Instagram uses hide. */
export async function setCommentHidden(
  commentId: string,
  pageToken: string,
  hidden: boolean,
  platform: "facebook_page" | "instagram",
  env: Env = process.env
) {
  const field = platform === "instagram" ? "hide" : "is_hidden";
  return providerFetch<{ success: boolean }>(graph(env, `/${encodeURIComponent(commentId)}`), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: authed(env, pageToken, { [field]: String(hidden) }),
  });
}
