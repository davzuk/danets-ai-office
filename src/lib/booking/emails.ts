// Booking emails: the visitor's confirmation / update / cancellation /
// reminder, and the business's copy. Visitor emails speak for the tenant
// (their business name), not for Danets. Every value is escaped.

import { escapeHtml, sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { buildIcs } from "./ics";
import { LOCATION_LABEL } from "./slots";

export interface BookingEmailData {
  bookingId: string;
  sequence: number;
  businessName: string;
  /** Where the business gets its copy (assigned user, business email or an admin). */
  businessEmail: string | null;
  typeName: string;
  location: string;
  locationDetail: string | null;
  startsAt: Date;
  endsAt: Date;
  businessTimezone: string;
  visitorTimezone: string | null;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  answers: { label: string; value: string }[];
  manageUrl: string;
  dashboardUrl: string;
}

export type BookingEmailKind = "confirmed" | "rescheduled" | "cancelled" | "reminder";

function when(d: BookingEmailData, tz: string) {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d.startsAt);
  const time = (x: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(x);
  return `${day}, ${time(d.startsAt)}–${time(d.endsAt)} (${tz})`;
}

function layout(heading: string, intro: string, rows: { label: string; value: string }[], cta: { label: string; href: string } | null, footer: string) {
  const body = rows
    .filter((r) => r.value)
    .map((r) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:14px;vertical-align:top;">${escapeHtml(r.label)}</td><td style="padding:6px 0;font-size:14px;font-weight:600;">${escapeHtml(r.value).replace(/\n/g, "<br>")}</td></tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:20px;"><div style="background:#fff;border-radius:14px;padding:28px;">
<h1 style="margin:0 0 8px;font-size:21px;color:#111827;">${escapeHtml(heading)}</h1>
<p style="margin:0 0 18px;font-size:14px;color:#4b5563;line-height:1.6;">${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;margin-bottom:20px;">${body}</table>
${cta ? `<a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:600;font-size:14px;">${escapeHtml(cta.label)}</a>` : ""}
<p style="margin:22px 0 0;font-size:12px;color:#9ca3af;">${escapeHtml(footer)}</p>
</div></div></body></html>`;
}

const text = (heading: string, intro: string, rows: { label: string; value: string }[], link?: string) =>
  [heading, "", intro, "", ...rows.filter((r) => r.value).map((r) => `${r.label}: ${r.value}`), ...(link ? ["", link] : [])].join("\n");

const subjectSafe = (s: string) => s.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

function where(d: BookingEmailData) {
  const label = LOCATION_LABEL[d.location] ?? d.location;
  return d.locationDetail ? `${label}: ${d.locationDetail}` : label;
}

/** The visitor's email for a booking event. */
export function visitorEmail(kind: BookingEmailKind, d: BookingEmailData) {
  const tz = d.visitorTimezone || d.businessTimezone;
  const rows = [
    { label: "What", value: `${d.typeName} with ${d.businessName}` },
    { label: "When", value: when(d, tz) },
    { label: "Where", value: where(d) },
  ];
  const copy = {
    confirmed: { subject: `Confirmed: ${d.typeName} with ${d.businessName}`, heading: "You're booked", intro: `Thanks, ${d.name}. Your booking is confirmed and a calendar invite is attached.` },
    rescheduled: { subject: `Updated: ${d.typeName} with ${d.businessName}`, heading: "Your booking has moved", intro: `Hi ${d.name}, here are the new details. The attached invite replaces the earlier one.` },
    cancelled: { subject: `Cancelled: ${d.typeName} with ${d.businessName}`, heading: "Your booking is cancelled", intro: `Hi ${d.name}, this booking has been cancelled.` },
    reminder: { subject: `Reminder: ${d.typeName} with ${d.businessName}`, heading: "See you soon", intro: `Hi ${d.name}, this is a reminder of your upcoming booking.` },
  }[kind];
  const cta = kind === "cancelled" ? null : { label: "Reschedule or cancel", href: d.manageUrl };
  return {
    subject: subjectSafe(copy.subject),
    html: layout(copy.heading, copy.intro, rows, cta, `Sent on behalf of ${d.businessName}. You're receiving this because you booked a time with them.`),
    text: text(copy.heading, copy.intro, rows, kind === "cancelled" ? undefined : `Reschedule or cancel: ${d.manageUrl}`),
  };
}

/** The business's copy (new, moved or cancelled bookings). */
export function businessEmail(kind: Exclude<BookingEmailKind, "reminder">, d: BookingEmailData, cancelledBy?: string | null) {
  const rows = [
    { label: "Who", value: [d.name, d.email, d.phone].filter(Boolean).join(" · ") },
    { label: "What", value: d.typeName },
    { label: "When", value: when(d, d.businessTimezone) },
    { label: "Where", value: where(d) },
    ...d.answers,
    { label: "Notes", value: d.notes ?? "" },
  ];
  const copy = {
    confirmed: { subject: `New booking: ${d.name}, ${d.typeName}`, heading: "New booking", intro: `${d.name} booked a ${d.typeName}.` },
    rescheduled: { subject: `Booking moved: ${d.name}, ${d.typeName}`, heading: "Booking moved", intro: `${d.name} moved their ${d.typeName} to a new time.` },
    cancelled: {
      subject: `Booking cancelled: ${d.name}, ${d.typeName}`,
      heading: "Booking cancelled",
      intro: cancelledBy === "visitor" ? `${d.name} cancelled their ${d.typeName}.` : `The ${d.typeName} with ${d.name} was cancelled.`,
    },
  }[kind];
  return {
    subject: subjectSafe(copy.subject),
    html: layout(copy.heading, copy.intro, rows, { label: "Open bookings", href: d.dashboardUrl }, "Danets AI Automation booking notification."),
    text: text(copy.heading, copy.intro, rows, d.dashboardUrl),
  };
}

function invite(kind: BookingEmailKind, d: BookingEmailData, organizerEmail: string) {
  return buildIcs({
    uid: `${d.bookingId}@danets-booking`,
    sequence: d.sequence,
    start: d.startsAt,
    end: d.endsAt,
    summary: `${d.typeName}: ${d.businessName} & ${d.name}`,
    description: [where(d), d.notes ? `Notes: ${d.notes}` : "", `Manage: ${d.manageUrl}`].filter(Boolean).join("\n"),
    location: where(d),
    organizer: { name: d.businessName, email: organizerEmail },
    attendee: { name: d.name, email: d.email },
    method: kind === "cancelled" ? "CANCEL" : "REQUEST",
    url: d.manageUrl,
  });
}

const fromAddress = () => process.env.SMTP_FROM || process.env.SENDGRID_FROM || process.env.EMAIL_FROM || "noreply@danetstecpro.com";

/** Send the visitor's (and, except for reminders, the business's) email. Never throws. */
export async function sendBookingEmails(kind: BookingEmailKind, d: BookingEmailData, opts: { cancelledBy?: string | null } = {}) {
  const organizer = d.businessEmail || fromAddress();
  const ics = invite(kind, d, organizer);
  const attachment = { filename: "invite.ics", content: ics, contentType: `text/calendar; charset=utf-8; method=${kind === "cancelled" ? "CANCEL" : "REQUEST"}` };
  const jobs: Promise<unknown>[] = [];
  const v = visitorEmail(kind, d);
  jobs.push(
    sendEmail({ to: d.email, ...v, attachments: kind === "reminder" ? undefined : [attachment] }).then((r) => {
      if (!r.success) logger.warn("booking email to visitor not sent", { bookingId: d.bookingId, kind, error: r.error });
    })
  );
  if (kind !== "reminder" && d.businessEmail) {
    const b = businessEmail(kind, d, opts.cancelledBy);
    jobs.push(
      sendEmail({ to: d.businessEmail, ...b, attachments: [attachment] }).then((r) => {
        if (!r.success) logger.warn("booking email to business not sent", { bookingId: d.bookingId, kind, error: r.error });
      })
    );
  }
  await Promise.allSettled(jobs);
}
