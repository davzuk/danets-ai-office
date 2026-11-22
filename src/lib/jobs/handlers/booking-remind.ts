import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendBookingEmails } from "@/lib/booking/emails";
import { emailDataFor } from "@/lib/booking/service";
import { defineJob } from "../define";

/**
 * Reminder email to the visitor, 24 hours and 1 hour before a booking.
 * Queued with the booking's start in the payload: if the booking was moved
 * or cancelled since, this run does nothing (the move queued new reminders).
 */
export const bookingRemindJob = defineJob({
  type: "booking.remind",
  schema: z.object({
    bookingId: z.string().min(1),
    startsAt: z.string().datetime(),
    kind: z.enum(["24h", "1h"]),
  }),
  maxAttempts: 3,
  async handler({ bookingId, startsAt, kind }) {
    const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { status: true, startsAt: true } });
    if (!booking || booking.status !== "confirmed" || booking.startsAt.toISOString() !== startsAt) return;
    if (booking.startsAt.getTime() < Date.now()) return; // the worker was down past the meeting
    const data = await emailDataFor(bookingId);
    if (!data) return;
    await sendBookingEmails("reminder", data);
    logger.info("booking reminder sent", { bookingId, kind });
  },
});
