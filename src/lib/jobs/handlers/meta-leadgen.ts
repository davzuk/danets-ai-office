import { z } from "zod";
import type { SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { OAuthGrantError } from "@/lib/connections/types";
import { logger } from "@/lib/logger";
import { LimitExceededError } from "@/lib/plan-quota";
import { socialAccountToken } from "@/lib/social/accounts";
import { fetchForm, fetchLead, listFormLeads, listPageForms, type MetaLeadData } from "@/lib/social/meta-graph";
import { ensureLeadForm, importMetaLead } from "@/lib/social/meta-leads";
import { defineJob, NonRetryableError } from "../define";
import { enqueue } from "../queue";

const DAY = 24 * 60 * 60_000;
/** Meta keeps leads for 90 days; the first poll of a form reaches back this far. */
export const BACKFILL_DAYS = 90;
/** Re-request a little before the cursor so a lead written mid-poll isn't missed. */
const POLL_OVERLAP_MS = 10 * 60_000;

async function usableAccount(socialAccountId: string) {
  const acct = await db.socialAccount.findUnique({ where: { id: socialAccountId } });
  if (!acct || acct.status !== "active" || acct.platform !== "facebook_page" || !acct.leadSyncEnabled) return null;
  const token = socialAccountToken(acct);
  return token ? { acct, token } : null;
}

async function markAccountError(acct: SocialAccount, message: string) {
  await db.socialAccount.update({ where: { id: acct.id }, data: { status: "error", lastError: message.slice(0, 2000) } });
}

/**
 * Import one Meta lead (from a webhook or the poller). The poller passes the
 * full `lead` record it already fetched; webhooks only carry ids.
 */
export const metaLeadgenJob = defineJob({
  type: "meta.leadgen",
  schema: z.object({
    socialAccountId: z.string(),
    leadgenId: z.string(),
    formId: z.string().nullable(),
    adId: z.string().nullable(),
    createdTime: z.number().nullable(),
    lead: z.record(z.string(), z.unknown()).optional(),
  }),
  maxAttempts: 6,
  async handler(p) {
    const usable = await usableAccount(p.socialAccountId);
    if (!usable) {
      logger.info("Meta lead skipped: account unavailable or lead sync off", { socialAccountId: p.socialAccountId });
      return;
    }
    const { acct, token } = usable;

    let data: MetaLeadData;
    try {
      data = (p.lead as MetaLeadData | undefined) ?? (await fetchLead(p.leadgenId, token));
    } catch (e) {
      if (e instanceof OAuthGrantError) {
        await markAccountError(acct, `Meta refused lead access: ${e.message}. Reconnect Meta and check the leads_retrieval permission.`);
        throw new NonRetryableError(e.message);
      }
      throw e;
    }

    const formId = data.form_id ?? p.formId;
    let form = formId
      ? await db.metaLeadForm.findUnique({ where: { socialAccountId_formId: { socialAccountId: acct.id, formId } } })
      : null;
    if (formId && !form) {
      const meta = await fetchForm(formId, token).catch(() => ({ id: formId }));
      form = await ensureLeadForm(acct, meta);
    }

    try {
      const res = await importMetaLead(acct, form, data);
      logger.info("Meta lead processed", { socialAccountId: acct.id, status: res.status });
    } catch (e) {
      if (e instanceof LimitExceededError) {
        await createNotification({
          businessId: acct.businessId,
          type: "limit_reached",
          title: "Lead limit reached: Meta lead not imported",
          message: `A lead from ${acct.name} could not be imported because your plan's lead limit is used up. Upgrade your plan, then retry the failed job.`,
          data: { view: "subscription", socialAccountId: acct.id },
        });
        throw new NonRetryableError(e.message);
      }
      throw e;
    }
  },
});

/**
 * Safety net for dropped webhooks, and the 90-day backfill when lead sync is
 * switched on. Lists each Page's forms, then queues leads created since the
 * form's cursor. Queued imports share the webhook's dedupe key.
 */
export const metaLeadgenPollJob = defineJob({
  type: "meta.leadgen-poll",
  schema: z.object({ socialAccountId: z.string().optional() }),
  maxAttempts: 3,
  timeoutMs: 10 * 60_000,
  async handler({ socialAccountId }) {
    const accounts = await db.socialAccount.findMany({
      where: {
        platform: "facebook_page",
        status: "active",
        leadSyncEnabled: true,
        ...(socialAccountId ? { id: socialAccountId } : {}),
      },
    });
    let queued = 0;
    for (const acct of accounts) {
      const token = socialAccountToken(acct);
      if (!token) continue;
      try {
        queued += await pollAccount(acct, token);
      } catch (e) {
        if (e instanceof OAuthGrantError) {
          await markAccountError(acct, `Meta refused lead access: ${e.message}. Reconnect Meta.`);
          continue;
        }
        // One Page's outage shouldn't stop the others; the next hourly run retries.
        logger.warn("Meta lead poll failed for account", { socialAccountId: acct.id, error: (e as Error).message });
      }
    }
    logger.info("Meta lead poll finished", { accounts: accounts.length, queued });
  },
});

async function pollAccount(acct: SocialAccount, token: string): Promise<number> {
  const metaForms = await listPageForms(acct.externalId, token);
  let queued = 0;
  for (const mf of metaForms) {
    const form = await ensureLeadForm(acct, mf);
    if (!form.enabled) continue;
    const startedAt = new Date();
    const since = form.polledThrough
      ? new Date(form.polledThrough.getTime() - POLL_OVERLAP_MS)
      : new Date(startedAt.getTime() - BACKFILL_DAYS * DAY);
    const leads = await listFormLeads(form.formId, token, since);
    for (const lead of leads) {
      await enqueue(
        metaLeadgenJob,
        {
          socialAccountId: acct.id,
          leadgenId: lead.id,
          formId: form.formId,
          adId: lead.ad_id ?? null,
          createdTime: lead.created_time ? Math.floor(Date.parse(lead.created_time) / 1000) : null,
          lead: { ...lead, form_id: lead.form_id ?? form.formId } as Record<string, unknown>,
        },
        { businessId: acct.businessId, dedupeKey: `meta-leadgen:${lead.id}` }
      );
      queued++;
    }
    await db.metaLeadForm.update({ where: { id: form.id }, data: { polledThrough: startedAt } });
  }
  return queued;
}
