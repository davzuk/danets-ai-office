// Every job type the runner can execute. Add new handlers here.

import type { JobDefinition } from "./define";
import { bookingRemindJob } from "./handlers/booking-remind";
import { brandGenerateJob } from "./handlers/brand-generate";
import { connectionExpiringJob, connectionRefreshJob } from "./handlers/connection-refresh";
import { linkedinLeadgenJob, linkedinLeadgenPollJob } from "./handlers/linkedin-leadgen";
import { metaCommentJob, metaMessageJob } from "./handlers/meta-events";
import { metaLeadgenJob, metaLeadgenPollJob } from "./handlers/meta-leadgen";
import { metaWebhookJob } from "./handlers/meta-webhook";
import { purgeJobsJob } from "./handlers/purge-jobs";
import { socialInsightsBusinessJob, socialInsightsWeeklyJob } from "./handlers/social-insights";
import { socialMetricsAccountJob, socialMetricsPostJob } from "./handlers/social-metrics";
import { socialPublishJob } from "./handlers/social-publish";
import { socialSubscribeJob } from "./handlers/social-subscribe";

const definitions: JobDefinition[] = [
  purgeJobsJob,
  connectionRefreshJob,
  connectionExpiringJob,
  metaWebhookJob,
  metaLeadgenJob,
  metaLeadgenPollJob,
  metaMessageJob,
  metaCommentJob,
  brandGenerateJob,
  socialSubscribeJob,
  socialPublishJob,
  linkedinLeadgenJob,
  linkedinLeadgenPollJob,
  socialMetricsPostJob,
  socialMetricsAccountJob,
  socialInsightsWeeklyJob,
  socialInsightsBusinessJob,
  bookingRemindJob,
];

const byType = new Map<string, JobDefinition>();
for (const def of definitions) {
  if (byType.has(def.type)) throw new Error(`Duplicate job type: ${def.type}`);
  byType.set(def.type, def);
}

export function getJobDefinition(type: string): JobDefinition | undefined {
  return byType.get(type);
}

export function listJobTypes(): string[] {
  return [...byType.keys()];
}
