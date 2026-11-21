import { z } from "zod";
import type { SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { ConnectionUnavailableError, getAccessToken } from "@/lib/connections/tokens";
import { OAuthGrantError } from "@/lib/connections/types";
import { logger } from "@/lib/logger";
import { LimitExceededError } from "@/lib/plan-quota";
import {
  LINKEDIN_LEAD_TYPES,
  fetchLinkedInForm,
  formIdFromVersionedUrn,
  linkedinLeadInput,
  listLeadResponses,
  toFormData,
  type LinkedInForm,
  type LinkedInLeadResponse,
} from "@/lib/social/linkedin-leads";
import { ensureLeadForm, importAdLead } from "@/lib/social/meta-leads";
import { PublishError } from "@/lib/social/publish/meta-http";
import { linkedinClient } from "@/lib/social/publish/linkedin";
import { defineJob, NonRetryableError } from "../define";
import { enqueue } from "../queue";

const DAY = 24 * 60 * 60_000;
/** First poll for a Page reaches back this far (LinkedIn keeps responses for 90 days). */
export const LINKEDIN_BACKFILL_DAYS = 90;
const POLL_OVERLAP_MS = 10 * 60_000;

async function usableAccount(socialAccountId: string) {
  const acct = await db.socialAccount.findUnique({ where: { id: socialAccountId } });
  if (!acct || acct.status !== "active" || acct.platform !== "linkedin_page" || !acct.leadSyncEnabled) return null;
  return acct;
}

async function memberToken(acct: SocialAccount) {
  try {
    return await getAccessToken(acct.connectionId, acct.businessId);
  } catch (e) {
    if (e instanceof ConnectionUnavailableError || e instanceof OAuthGrantError) return null;
    throw e;
  }
}

/** Lead Sync isn't approved or granted: turn sync off for the Page and say why, once. */
async function disableLeadSync(acct: SocialAccount, reason: string) {
  await db.socialAccount.update({
    where: { id: acct.id },
    data: { leadSyncEnabled: false, lastError: `LinkedIn lead sync stopped: ${reason}`.slice(0, 2000) },
  });
  await createNotification({
    businessId: acct.businessId,
    type: "integration_error",
    title: "LinkedIn lead sync stopped",
    message: `Danets couldn't read lead forms for ${acct.name} (${reason}). Reconnect LinkedIn with lead access, then turn Lead Ads back on.`,
    data: { socialAccountId: acct.id },
  });
}

/** Import one LinkedIn lead response (queued by the poller). */
export const linkedinLeadgenJob = defineJob({
  type: "linkedin.leadgen",
  schema: z.object({ socialAccountId: z.string(), lead: z.record(z.string(), z.unknown()) }),
  maxAttempts: 6,
  async handler(p) {
    const acct = await usableAccount(p.socialAccountId);
    if (!acct) return;
    const lead = p.lead as LinkedInLeadResponse;
    const formId = formIdFromVersionedUrn(lead.versionedLeadGenFormUrn);

    let formRow = formId ? await db.metaLeadForm.findUnique({ where: { socialAccountId_formId: { socialAccountId: acct.id, formId } } }) : null;
    let formMeta: LinkedInForm | null = null;
    if (formId) {
      const token = await memberToken(acct);
      formMeta = token ? await fetchLinkedInForm(linkedinClient(token), formId) : null;
      if (!formRow || formMeta) formRow = await ensureLeadForm(acct, toFormData(formId, formMeta));
    }

    try {
      const res = await importAdLead(acct, formRow, linkedinLeadInput(lead, formMeta));
      logger.info("LinkedIn lead processed", { socialAccountId: acct.id, status: res.status });
    } catch (e) {
      if (e instanceof LimitExceededError) {
        await createNotification({
          businessId: acct.businessId,
          type: "limit_reached",
          title: "Lead limit reached: LinkedIn lead not imported",
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
 * Every 15 minutes: read new lead responses for each LinkedIn Page with lead
 * sync on, and queue an import per lead. LinkedIn's lead notification
 * webhooks can replace this later.
 */
export const linkedinLeadgenPollJob = defineJob({
  type: "linkedin.leadgen-poll",
  schema: z.object({ socialAccountId: z.string().optional() }),
  maxAttempts: 3,
  timeoutMs: 10 * 60_000,
  async handler({ socialAccountId }) {
    const accounts = await db.socialAccount.findMany({
      where: { platform: "linkedin_page", status: "active", leadSyncEnabled: true, ...(socialAccountId ? { id: socialAccountId } : {}) },
    });
    let queued = 0;
    for (const acct of accounts) {
      const token = await memberToken(acct);
      if (!token) continue; // the connection layer has already told the tenant
      try {
        queued += await pollAccount(acct, token);
      } catch (e) {
        if (e instanceof PublishError && e.kind === "auth") {
          await disableLeadSync(acct, e.message);
          continue;
        }
        logger.warn("LinkedIn lead poll failed for account", { socialAccountId: acct.id, error: (e as Error).message });
      }
    }
    logger.info("LinkedIn lead poll finished", { accounts: accounts.length, queued });
  },
});

async function pollAccount(acct: SocialAccount, token: string): Promise<number> {
  const client = linkedinClient(token);
  const forms = await db.metaLeadForm.findMany({ where: { socialAccountId: acct.id }, select: { polledThrough: true } });
  const cursor = forms.reduce<Date | null>((max, f) => (f.polledThrough && (!max || f.polledThrough > max) ? f.polledThrough : max), null);
  const until = new Date();
  const since = cursor ? new Date(cursor.getTime() - POLL_OVERLAP_MS) : new Date(until.getTime() - LINKEDIN_BACKFILL_DAYS * DAY);

  let queued = 0;
  for (const leadType of LINKEDIN_LEAD_TYPES) {
    const leads = await listLeadResponses(client, acct.externalId, since, until, leadType);
    // Make sure each form has a row now, so the cursor below is saved on it.
    for (const formId of new Set(leads.map((l) => formIdFromVersionedUrn(l.versionedLeadGenFormUrn)).filter((x): x is string => !!x))) {
      const exists = await db.metaLeadForm.findUnique({ where: { socialAccountId_formId: { socialAccountId: acct.id, formId } }, select: { id: true } });
      if (!exists) await ensureLeadForm(acct, toFormData(formId, await fetchLinkedInForm(client, formId)));
    }
    for (const lead of leads) {
      await enqueue(
        linkedinLeadgenJob,
        { socialAccountId: acct.id, lead: lead as Record<string, unknown> },
        { businessId: acct.businessId, dedupeKey: `linkedin-leadgen:${lead.id}` }
      );
      queued++;
    }
  }
  // The cursor lives on the Page's form rows; a Page with no forms yet keeps backfilling.
  await db.metaLeadForm.updateMany({ where: { socialAccountId: acct.id }, data: { polledThrough: until } });
  return queued;
}
