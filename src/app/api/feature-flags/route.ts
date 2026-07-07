import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getFeatureFlagsForBusiness } from "@/lib/feature-flags";

// GET /api/feature-flags — effective flags for the current tenant
export async function GET() {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const flags = await getFeatureFlagsForBusiness(user.businessId);
  return NextResponse.json({ flags });
}
