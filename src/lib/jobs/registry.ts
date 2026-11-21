// Every job type the runner can execute. Add new handlers here.

import type { JobDefinition } from "./define";
import { purgeJobsJob } from "./handlers/purge-jobs";

const definitions: JobDefinition[] = [purgeJobsJob];

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
