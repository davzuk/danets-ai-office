// Every job type the runner can execute. Add new handlers here.

import type { JobDefinition } from "./define";
import { brandGenerateJob } from "./handlers/brand-generate";
import { connectionExpiringJob, connectionRefreshJob } from "./handlers/connection-refresh";
import { metaCommentJob, metaMessageJob } from "./handlers/meta-events";
import { metaLeadgenJob, metaLeadgenPollJob } from "./handlers/meta-leadgen";
import { metaWebhookJob } from "./handlers/meta-webhook";
import { purgeJobsJob } from "./handlers/purge-jobs";
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
