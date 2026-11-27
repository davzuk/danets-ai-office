import "server-only";
// A managed Business Profile location doubles as a publishing account
// (SocialAccount, platform "google_business"), so the Content Studio
// calendar, approval flow and social.publish job can post to it. The
// BusinessLocation row stays the source of truth; this mirrors it.

import type { BusinessLocation } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { v4LocationPath } from "./gbp";

export const GBP_ACCOUNT_PLATFORM = "google_business";

export function locationAccountKey(loc: Pick<BusinessLocation, "accountName" | "locationName">): string {
  return v4LocationPath(loc.accountName, loc.locationName);
}

/** Create (or re-point) the publishing account for a location. */
export async function ensureLocationAccount(loc: BusinessLocation): Promise<void> {
  const externalId = locationAccountKey(loc);
  const existing = await db.socialAccount.findUnique({ where: { platform_externalId: { platform: GBP_ACCOUNT_PLATFORM, externalId } } });
  if (existing && existing.businessId !== loc.businessId) {
    // Another workspace manages the same location and already posts to it.
    logger.warn("Business Profile location already publishes for another workspace", { locationId: loc.id });
    return;
  }
  const fields = {
    connectionId: loc.connectionId,
    name: loc.title.slice(0, 191),
    status: loc.status === "active" ? "active" : "error",
    lastError: loc.status === "active" ? null : loc.error,
  };
  if (existing) await db.socialAccount.update({ where: { id: existing.id }, data: fields });
  else await db.socialAccount.create({ data: { businessId: loc.businessId, platform: GBP_ACCOUNT_PLATFORM, externalId, ...fields } });
}

export async function removeLocationAccount(loc: BusinessLocation): Promise<void> {
  await db.socialAccount.deleteMany({ where: { businessId: loc.businessId, platform: GBP_ACCOUNT_PLATFORM, externalId: locationAccountKey(loc) } });
}

/** Keep the account's status in step with the location's health. */
export async function mirrorLocationStatus(loc: BusinessLocation, status: string, error: string | null): Promise<void> {
  await db.socialAccount.updateMany({
    where: { businessId: loc.businessId, platform: GBP_ACCOUNT_PLATFORM, externalId: locationAccountKey(loc) },
    data: { status: status === "active" ? "active" : "error", lastError: status === "active" ? null : error },
  });
}

/** The location behind a google_business publishing account. */
export async function locationForAccount(acct: { businessId: string; externalId: string }): Promise<BusinessLocation | null> {
  const [accountName, locationName] = [acct.externalId.split("/").slice(0, 2).join("/"), acct.externalId.split("/").slice(2, 4).join("/")];
  return db.businessLocation.findFirst({ where: { businessId: acct.businessId, accountName, locationName } });
}
