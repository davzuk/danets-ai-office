// What Meta's deauthorize and data-deletion callbacks do to our data.
// Both are keyed by the app-scoped Meta user id, which is the connection's
// externalAccountId.

import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { markConnectionFailed } from "@/lib/connections/tokens";

/** The user removed our app in Facebook: stop using their grant. Returns connections affected. */
export async function handleMetaDeauthorize(metaUserId: string): Promise<number> {
  const rows = await db.oAuthConnection.findMany({ where: { provider: "meta", externalAccountId: metaUserId } });
  for (const row of rows) {
    await db.socialAccount.updateMany({
      where: { connectionId: row.id },
      data: { status: "revoked", subscribedAt: null, lastError: "App removed in Facebook settings" },
    });
    await markConnectionFailed(row, "revoked", "The app was removed in Facebook settings.");
  }
  return rows.length;
}

/**
 * The user asked Meta to delete their data: remove the connections (and,
 * by cascade, their social accounts and page tokens) and record the
 * request so its status page works. Leads and conversations belong to the
 * tenant business, not to the Facebook user who connected the Page.
 */
export async function handleMetaDataDeletion(metaUserId: string) {
  const rows = await db.oAuthConnection.findMany({
    where: { provider: "meta", externalAccountId: metaUserId },
    include: { _count: { select: { socialAccounts: true } } },
  });
  const code = randomBytes(12).toString("hex");
  const deleted = {
    connections: rows.length,
    socialAccounts: rows.reduce((n, r) => n + r._count.socialAccounts, 0),
  };

  await db.$transaction([
    db.oAuthConnection.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    db.metaDataDeletionRequest.create({
      data: { code, metaUserId, status: "completed", deleted: deleted as Prisma.InputJsonValue, completedAt: new Date() },
    }),
  ]);

  for (const row of rows) {
    await logActivity({
      businessId: row.businessId,
      userName: "Meta",
      action: "connection_removed",
      module: "integrations",
      description: `Meta account ${row.accountName ?? row.externalAccountId} removed at the user's data-deletion request`,
      metadata: { connectionId: row.id, confirmationCode: code },
    });
  }
  return { code, deleted };
}
