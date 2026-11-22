import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { publicPreflight, withPublicCors } from "@/lib/public-cors";
import { isValidTimezoneName, publicBookingBusiness } from "@/lib/booking/public";
import { readQuestions } from "@/lib/booking/slots";
import { BookingError, createBooking } from "@/lib/booking/service";

// POST /api/public/bookings: book a slot from the hosted page or the widget.
// The slot is checked again inside a transaction, so of two visitors picking
// the same time exactly one gets it (the other gets 409 SLOT_TAKEN).

const schema = z.object({
  pk: z.string().min(1).max(191),
  type: z.string().min(1).max(80),
  start: z.string().datetime(),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(191),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  answers: z.record(z.string().max(60), z.string().max(1000)).optional(),
  timezone: z.string().max(64).optional(),
  source: z.enum(["page", "widget"]).default("page"),
  sessionId: z.string().max(191).nullable().optional(),
  visitorId: z.string().max(191).nullable().optional(),
  attribution: z.unknown().optional(),
  consentText: z.string().max(300).optional(),
  // Honeypot: a hidden field people never fill in.
  website: z.string().max(0).optional().or(z.literal("")),
});

export const OPTIONS = publicPreflight;

export const POST = withPublicCors(async (req: NextRequest) => {
  const rl = await rateLimit(`booking:${getClientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.success) return NextResponse.json({ error: "Too many bookings from this network. Please try again later." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === "email" ? "Please enter a valid email address." : field === "name" ? "Please enter your name." : field === "start" ? "Please pick a time." : "Please check your details.";
    return NextResponse.json({ error, field }, { status: 400 });
  }
  const d = parsed.data;

  const business = await publicBookingBusiness(req, d.pk);
  if (business instanceof NextResponse) return business;

  const type = await db.bookingType.findUnique({ where: { businessId_slug: { businessId: business.id, slug: d.type } } });
  if (!type || !type.active) return NextResponse.json({ error: "This booking page isn't available." }, { status: 404 });
  if (type.provider === "calendly") return NextResponse.json({ error: "This meeting is booked through Calendly.", code: "EXTERNAL" }, { status: 409 });

  // Keep only answers to this type's questions, and require the required ones.
  const answers: Record<string, string> = {};
  for (const q of readQuestions(type.questions)) {
    const v = d.answers?.[q.key]?.trim() ?? "";
    if (q.required && !v) return NextResponse.json({ error: `Please answer: ${q.label}`, field: `answers.${q.key}` }, { status: 400 });
    if (v) answers[q.key] = v;
  }

  try {
    const booking = await createBooking({
      business,
      type,
      start: new Date(d.start),
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      notes: d.notes || null,
      answers,
      visitorTimezone: isValidTimezoneName(d.timezone) ? d.timezone : null,
      source: d.source,
      sessionId: d.sessionId,
      visitorId: d.visitorId,
      attribution: d.attribution,
      consentText: d.consentText,
    });
    return NextResponse.json({
      bookingId: booking.id,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      manageToken: booking.cancelToken,
    });
  } catch (e) {
    if (e instanceof BookingError) {
      const status = e.code === "SLOT_TAKEN" ? 409 : e.code === "CLOSED" ? 403 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }
});
