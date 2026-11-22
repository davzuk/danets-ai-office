import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicPreflight, withPublicCors } from "@/lib/public-cors";
import { publicBookingBusiness, publicType } from "@/lib/booking/public";

// GET /api/public/booking/types?pk=…  The active booking types, for the
// widget's booking step and the hosted booking page.

export const OPTIONS = publicPreflight;

export const GET = withPublicCors(async (req: NextRequest) => {
  const business = await publicBookingBusiness(req, req.nextUrl.searchParams.get("pk"));
  if (business instanceof NextResponse) return business;
  const types = await db.bookingType.findMany({
    where: { businessId: business.id, active: true },
    orderBy: [{ createdAt: "asc" }],
  });
  return NextResponse.json(
    { business: { name: business.name, timezone: business.timezone }, types: types.map(publicType) },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
});
