import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { publicPreflight, withPublicCors } from "@/lib/public-cors";
import { isValidTimezoneName, publicBookingBusiness, publicType } from "@/lib/booking/public";
import { groupSlotsByDay } from "@/lib/booking/slots";
import { slotsFor } from "@/lib/booking/service";

// GET /api/public/booking/slots?pk&type&from&to&tz
// Free start times between from and to (ISO, at most 35 days apart), grouped
// by day in the visitor's timezone (tz), or the business's when tz is absent.

const MAX_RANGE_MS = 35 * 86_400_000;

export const OPTIONS = publicPreflight;

export const GET = withPublicCors(async (req: NextRequest) => {
  const rl = await rateLimit(`bslots:${getClientIp(req)}`, 120, 10 * 60 * 1000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const q = req.nextUrl.searchParams;
  const business = await publicBookingBusiness(req, q.get("pk"));
  if (business instanceof NextResponse) return business;

  const slug = q.get("type");
  const type = slug
    ? await db.bookingType.findUnique({ where: { businessId_slug: { businessId: business.id, slug } } })
    : await db.bookingType.findFirst({ where: { businessId: business.id, active: true, provider: "native" }, orderBy: { createdAt: "asc" } });
  if (!type || !type.active) return NextResponse.json({ error: "This booking page isn't available." }, { status: 404 });

  const now = new Date();
  const from = q.get("from") ? new Date(q.get("from")!) : now;
  const to = q.get("to") ? new Date(q.get("to")!) : new Date(from.getTime() + 14 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  }
  const tz = isValidTimezoneName(q.get("tz")) ? q.get("tz")! : business.timezone;

  const slots = await slotsFor(type, business.timezone, { from, to }, now);
  const horizon = new Date(now.getTime() + type.maxDaysAhead * 86_400_000);
  return NextResponse.json(
    {
      business: { name: business.name, timezone: business.timezone },
      type: publicType(type),
      timezone: tz,
      days: groupSlotsByDay(slots, tz),
      // Lets the page stop paging forward once nothing more can be booked.
      bookableUntil: horizon.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});
