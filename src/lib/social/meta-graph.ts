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
