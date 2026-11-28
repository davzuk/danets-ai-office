import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { opportunitiesData } from "@/lib/seo/keywords";
import { enqueueOpportunitiesScan } from "@/lib/jobs/handlers/seo-opportunities";

// GET /api/seo/opportunities?propertyId=&dismissed=1: the latest weekly
// opportunities. A property with search data but no scan yet gets one queued.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const q = new URL(req.url).searchParams;
    const data = await opportunitiesData(user.businessId, { propertyId: q.get("propertyId"), dismissed: q.get("dismissed") === "1" });
    const property = data.properties.find((p) => p.id === data.propertyId);
    let scanning = false;
    if (property && !property.opportunitiesAt && property.syncedThrough && property.status !== "lost_access") {
      await enqueueOpportunitiesScan(property.id, user.businessId, "first");
      scanning = true;
    }
    return { ...data, scanning, canEdit: user.role === "admin" };
  });
}
