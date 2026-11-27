import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { availableLocations } from "@/lib/seo/setup";

// GET /api/seo/google/locations?connectionId=: Business Profile locations
// the connected Google account manages.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const connectionId = req.nextUrl.searchParams.get("connectionId") ?? "";
    return { locations: await availableLocations(user.businessId, connectionId) };
  });
}
