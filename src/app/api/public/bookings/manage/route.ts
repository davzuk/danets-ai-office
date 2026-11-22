import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { publicPreflight, withPublicCors } from "@/lib/public-cors";
import { LOCATION_LABEL } from "@/lib/booking/slots";
import { BookingError, cancelBooking, rescheduleBooking } from "@/lib/booking/service";

// The visitor's manage link (/book/manage/<token>): see, cancel or move a
// booking. The token is the only credential, so it's long, random and
// unique, and every call is rate-limited per IP.

const TOKEN = z.string().min(20).max(64).regex(/^[A-Za-z0-9_-]+$/);

async function limited(req: NextRequest) {
  const rl = await rateLimit(`bmanage:${getClientIp(req)}`, 30, 10 * 60 * 1000);
  return rl.success ? null : NextResponse.json({ error: "Too many requests." }, { status: 429 });
}

export const OPTIONS = publicPreflight;

export const GET = withPublicCors(async (req: NextRequest) => {
  const tooMany = await limited(req);
  if (tooMany) return tooMany;
  const token = TOKEN.safeParse(req.nextUrl.searchParams.get("token"));
  if (!token.success) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  const b = await db.booking.findUnique({
    where: { cancelToken: token.data },
    include: { bookingType: true, business: { select: { name: true, timezone: true, publicKey: true } } },
  });
  if (!b) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  return NextResponse.json(
    {
      booking: {
        name: b.name,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        status: b.status,
        visitorTimezone: b.visitorTimezone,
        canChange: b.status === "confirmed" && b.startsAt.getTime() > Date.now() && !!b.bookingType?.active && b.externalProvider !== "calendly",
      },
      type: b.bookingType
        ? {
            slug: b.bookingType.slug,
            name: b.bookingType.name,
            durationMin: b.bookingType.durationMin,
            locationLabel: LOCATION_LABEL[b.bookingType.location] ?? b.bookingType.location,
            locationDetail: b.status === "confirmed" ? b.bookingType.locationDetail : null,
          }
        : null,
      business: { name: b.business.name, timezone: b.business.timezone, pk: b.business.publicKey },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ token: TOKEN, action: z.literal("cancel"), reason: z.string().max(500).optional() }),
  z.object({ token: TOKEN, action: z.literal("reschedule"), start: z.string().datetime() }),
]);

export const POST = withPublicCors(async (req: NextRequest) => {
  const tooMany = await limited(req);
  if (tooMany) return tooMany;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const d = parsed.data;
  const existing = await db.booking.findUnique({ where: { cancelToken: d.token }, select: { startsAt: true, externalProvider: true } });
  if (!existing) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (existing.externalProvider === "calendly") {
    return NextResponse.json({ error: "This booking is managed in Calendly. Use the link in your Calendly email." }, { status: 409 });
  }
  if (existing.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "This booking has already started, so it can't be changed online." }, { status: 400 });
  }
  try {
    const b =
      d.action === "cancel"
        ? await cancelBooking({ cancelToken: d.token }, "visitor", d.reason)
        : await rescheduleBooking({ cancelToken: d.token }, new Date(d.start));
    return NextResponse.json({ status: b.status, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() });
  } catch (e) {
    if (e instanceof BookingError) {
      const status = e.code === "SLOT_TAKEN" ? 409 : e.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }
});
