import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { db } from "@/lib/db";
import { enqueueOpportunitiesScan } from "@/lib/jobs/handlers/seo-opportunities";

// POST {propertyId}: re-scan for opportunities now (admin, at most once an hour).
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const body = (await req.json().catch(() => null)) as { propertyId?: unknown } | null;
    const property =
      typeof body?.propertyId === "string"
        ? await db.searchProperty.findFirst({ where: { id: body.propertyId, businessId: user.businessId } })
        : await db.searchProperty.findFirst({ where: { businessId: user.businessId }, orderBy: { createdAt: "asc" } });
    if (!property) throw new AppError("Add a Search Console property first.", { status: 400, code: "NO_PROPERTY" });
    if (!property.syncedThrough) throw new AppError("Search data is still loading. Try again once the first sync has finished.", { status: 409, code: "NOT_READY" });
    if (property.status === "lost_access") throw new AppError("Danets can no longer read this property. Reconnect Google on the Setup tab.", { status: 409, code: "LOST_ACCESS" });
    await enqueueOpportunitiesScan(property.id, user.businessId, "refresh");
    return { queued: true };
  });
}
