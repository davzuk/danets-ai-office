import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { availableSites } from "@/lib/seo/setup";

// GET /api/seo/google/sites?connectionId=: Search Console properties the
// connected Google account can read.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const connectionId = req.nextUrl.searchParams.get("connectionId") ?? "";
    return { sites: await availableSites(user.businessId, connectionId) };
  });
}
