// Turn one Meta webhook delivery into typed events. Pure: no DB, no I/O.
//
// object "page":      entry.id = Page id; changes (leadgen, feed) + messaging (Messenger)
// object "instagram": entry.id = IG account id; changes (comments) + messaging (IG DMs)

import type { SocialPlatform } from "@/lib/connections/types";

export type MetaEvent =
  | {
      kind: "leadgen";
      platform: "facebook_page";
      accountExternalId: string;
      leadgenId: string;
      formId: string | null;
      adId: string | null;
      createdTime: number | null;
    }
  | {
      kind: "message";
      platform: SocialPlatform;
      accountExternalId: string;
      mid: string;
      senderId: string;
      recipientId: string;
      timestamp: number | null;
      /** Sent by the Page / IG account itself (from Meta's own inbox or our API). */
      isEcho: boolean;
      raw: Record<string, unknown>;
    }
  | {
      kind: "comment";
      platform: SocialPlatform;
      accountExternalId: string;
      commentId: string;
      verb: string;
      raw: Record<string, unknown>;
    };

export interface MetaRouting {
  events: MetaEvent[];
  /** Fields we saw but don't handle, for logging. */
  ignored: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function routeMetaWebhook(payload: { object: string; entry: unknown[] }): MetaRouting {
  const out: MetaRouting = { events: [], ignored: [] };
  const platform: SocialPlatform | null =
    payload.object === "page" ? "facebook_page" : payload.object === "instagram" ? "instagram" : null;
  if (!platform) {
    out.ignored.push(`object:${payload.object}`);
    return out;
  }

  for (const entry of payload.entry) {
    if (!isObj(entry)) continue;
    const accountId = str(entry.id);
    if (!accountId) continue;

    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const field = String(change.field ?? "");
      const v = change.value;

      if (platform === "facebook_page" && field === "leadgen") {
        const leadgenId = str(v.leadgen_id);
        if (!leadgenId) continue;
        out.events.push({
          kind: "leadgen",
          platform,
          accountExternalId: str(v.page_id) ?? accountId,
          leadgenId,
          formId: str(v.form_id),
          adId: str(v.ad_id),
          createdTime: num(v.created_time),
        });
      } else if (platform === "facebook_page" && field === "feed" && v.item === "comment") {
        const commentId = str(v.comment_id);
        if (commentId) out.events.push({ kind: "comment", platform, accountExternalId: accountId, commentId, verb: str(v.verb) ?? "add", raw: v });
      } else if (platform === "instagram" && field === "comments") {
        const commentId = str(v.id);
        if (commentId) out.events.push({ kind: "comment", platform, accountExternalId: accountId, commentId, verb: "add", raw: v });
      } else {
        out.ignored.push(`${payload.object}.${field}${field === "feed" && v.item ? `:${String(v.item)}` : ""}`);
      }
    }

    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!isObj(m)) continue;
      const message = isObj(m.message) ? m.message : null;
      const postback = isObj(m.postback) ? m.postback : null;
      // Delivery / read receipts carry no content.
      if (!message && !postback) {
        out.ignored.push(`${payload.object}.messaging:${Object.keys(m).find((k) => !["sender", "recipient", "timestamp"].includes(k)) ?? "other"}`);
        continue;
      }
      const senderId = str(isObj(m.sender) ? m.sender.id : null);
      const recipientId = str(isObj(m.recipient) ? m.recipient.id : null);
      const mid = str(message?.mid ?? postback?.mid) ?? (senderId && num(m.timestamp) ? `pb:${senderId}:${num(m.timestamp)}` : null);
      if (!senderId || !recipientId || !mid) continue;
      out.events.push({
        kind: "message",
        platform,
        accountExternalId: accountId,
        mid,
        senderId,
        recipientId,
        timestamp: num(m.timestamp),
        isEcho: message?.is_echo === true,
        raw: m,
      });
    }
  }
  return out;
}

/** Queue dedupe key: Meta retries deliveries, and one event can arrive in several. */
export function metaEventDedupeKey(e: MetaEvent): string {
  switch (e.kind) {
    case "leadgen":
      return `meta-leadgen:${e.leadgenId}`;
    case "message":
      return `meta-msg:${e.mid}`.slice(0, 191);
    case "comment":
      return `meta-comment:${e.commentId}:${e.verb}`.slice(0, 191);
  }
}
