/**
 * One-off (safe to re-run): link existing leads, chats, tickets and quotes
 * to unified Contacts after the contacts_attribution migration.
 *
 *   npm run contacts:backfill                 # all tenants
 *   npm run contacts:backfill -- --business=<id>
 */
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import { backfillContacts, type BackfillStats } from "@/lib/contacts-backfill";

async function main() {
  const businessId = process.argv.find((a) => a.startsWith("--business="))?.split("=")[1];
  const started = Date.now();
  const result = await backfillContacts({ businessId });
  logger.info("Contact backfill finished", { businessId: businessId ?? "all", ms: Date.now() - started, ...flatten(result) });
}

function flatten(r: Record<string, BackfillStats>) {
  const out: Record<string, number> = {};
  for (const [table, stats] of Object.entries(r)) for (const [k, v] of Object.entries(stats)) out[`${table}.${k}`] = v as number;
  return out;
}

main()
  .catch((e) => {
    logger.error("Contact backfill failed", serializeError(e));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
