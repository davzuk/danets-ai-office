import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { getConnectionProvider } from "@/lib/connections/registry";
import { deleteConnection } from "@/lib/connections/store";

type RouteCtx = { params: Promise<{ id: string }> };

// DELETE /api/connections/accounts/[id] — revoke at the provider and remove
export function DELETE(_req: Request, { params }: RouteCtx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");

    const { id } = await params;
    const row = await db.oAuthConnection.findFirst({ where: { id, businessId: user.businessId } });
    if (!row) throw new AppError("Connection not found", { status: 404, code: "NOT_FOUND" });

    await deleteConnection(row);

    const label = getConnectionProvider(row.provider)?.label ?? row.provider;
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "connection_removed",
      module: "integrations",
      description: `Disconnected ${label} account ${row.accountName ?? row.externalAccountId}`,
      metadata: { connectionId: row.id, provider: row.provider },
    });
    return { success: true };
  });
}
