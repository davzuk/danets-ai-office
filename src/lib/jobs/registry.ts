// Every job type the runner can execute. Add new handlers here.

import type { JobDefinition } from "./define";
import { brandGenerateJob } from "./handlers/brand-generate";
import { connectionExpiringJob, connectionRefreshJob } from "./handlers/connection-refresh";
import { metaWebhookJob } from "./handlers/meta-webhook";
import { purgeJobsJob } from "./handlers/purge-jobs";

const definitions: JobDefinition[] = [purgeJobsJob, connectionRefreshJob, connectionExpiringJob, metaWebhookJob, brandGenerateJob];

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
