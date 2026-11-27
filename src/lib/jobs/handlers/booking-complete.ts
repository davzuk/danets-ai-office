import { z } from "zod";
import { db } from "@/lib/db";
import { fireTrigger } from "@/lib/automation";
import { defineJob } from "../define";

/** How long after the meeting's end the booking counts as completed. */
export const COMPLETE_AFTER_MS = 30 * 60_000;
/** A worker that was down longer than this skips the trigger (a review request a week late reads oddly). */
export const COMPLETE_STALE_MS = 3 * 24 * 3_600_000;

/**
 * Fires the booking_completed automation trigger once a meeting is over
 * (for example to ask for a Google review). Queued with the booking's end
 * in the payload: a moved booking queued a fresh job, so this one no-ops,
 * and a cancelled or no-show booking never fires.
 */
export const bookingCompleteJob = defineJob({
  type: "booking.complete",
  schema: z.object({ bookingId: z.string().min(1), endsAt: z.string().datetime() }),
  maxAttempts: 3,
  async handler({ bookingId, endsAt }) {
    const b = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, businessId: true, status: true, endsAt: true, leadId: true, contactId: true, name: true, bookingType: { select: { name: true } } },
    });
    if (!b || b.endsAt.toISOString() !== endsAt) return;
    if (b.status !== "confirmed" && b.status !== "completed") return;
    const now = Date.now();
    if (now < b.endsAt.getTime() || now - b.endsAt.getTime() > COMPLETE_STALE_MS) return;
    await fireTrigger("booking_completed", {
      businessId: b.businessId,
      leadId: b.leadId ?? undefined,
      leadName: b.name,
      bookingId: b.id,
      contactId: b.contactId ?? undefined,
      bookingTypeName: b.bookingType?.name,
      endsAt,
    });
  },
});
