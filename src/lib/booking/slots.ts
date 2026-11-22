// Booking availability and slot calculation (Phase 2, workstream P).
//
// Weekly hours are wall-clock times in the business's IANA timezone, so a
// 09:00 start stays 09:00 local across daylight-saving changes. Everything
// here is pure (Intl only), so it runs in tests and in client components.

import { z } from "zod";
import { zonedDateKey, zonedParts, zonedToUtc } from "@/lib/content/timezone";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const interval = z
  .tuple([z.string().regex(HHMM, "Use HH:MM"), z.string().regex(HHMM, "Use HH:MM")])
  .refine(([a, b]) => toMin(a) < toMin(b), "A start time must be before its end time");

const dayHours = z
  .array(interval)
  .max(4)
  .default([])
  .refine((list) => {
    const sorted = [...list].sort((a, b) => toMin(a[0]) - toMin(b[0]));
    return sorted.every((iv, i) => i === 0 || toMin(sorted[i - 1][1]) <= toMin(iv[0]));
  }, "Hours on the same day can't overlap");

export const availabilitySchema = z.object({
  sun: dayHours,
  mon: dayHours,
  tue: dayHours,
  wed: dayHours,
  thu: dayHours,
  fri: dayHours,
  sat: dayHours,
});

export type Availability = z.output<typeof availabilitySchema>;

export const DEFAULT_AVAILABILITY: Availability = {
  sun: [],
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [],
};

export function readAvailability(raw: unknown): Availability {
  const parsed = availabilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_AVAILABILITY;
}

export const questionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(120),
  required: z.boolean().default(false),
});

export const bookingTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
    .max(80),
  description: z.string().trim().max(1000).optional().nullable(),
  durationMin: z.number().int().min(5).max(480),
  bufferMin: z.number().int().min(0).max(240).default(0),
  minNoticeHours: z.number().int().min(0).max(24 * 30).default(4),
  maxDaysAhead: z.number().int().min(1).max(365).default(30),
  slotStepMin: z.number().int().min(5).max(240).default(30),
  availability: availabilitySchema,
  location: z.enum(["phone", "video", "in_person", "custom"]).default("phone"),
  locationDetail: z.string().trim().max(500).optional().nullable(),
  questions: z.array(questionSchema).max(5).default([]),
  assignedUserId: z.string().max(191).optional().nullable(),
  active: z.boolean().default(true),
});

export type BookingTypeInput = z.output<typeof bookingTypeInputSchema>;

export function readQuestions(raw: unknown): z.output<typeof questionSchema>[] {
  const parsed = z.array(questionSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export interface Busy {
  start: Date;
  end: Date;
}

export interface SlotRules {
  availability: Availability;
  timezone: string;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  slotStepMin: number;
}

/** "YYYY-MM-DD" plus n days (calendar arithmetic, no zone). */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function weekdayOfKey(key: string): Weekday {
  const [y, m, d] = key.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Start times that are free, in order. A slot needs the meeting plus the
 * buffer to fit inside the day's hours, and must not overlap any busy
 * period padded by the buffer on both sides (existing bookings carry their
 * own buffer). Wall-clock times skipped by a DST jump are left out.
 */
export function computeSlots(rules: SlotRules, busy: Busy[], range: { from: Date; to: Date }, now: Date = new Date()): Date[] {
  const tz = rules.timezone;
  const earliest = new Date(Math.max(range.from.getTime(), now.getTime() + rules.minNoticeHours * 3_600_000));
  const latest = new Date(Math.min(range.to.getTime(), now.getTime() + rules.maxDaysAhead * 86_400_000));
  if (earliest >= latest) return [];

  const durMs = rules.durationMin * 60_000;
  const bufMs = rules.bufferMin * 60_000;
  const step = Math.max(5, rules.slotStepMin);
  const blocks = busy.map((b) => ({ start: b.start.getTime() - bufMs, end: b.end.getTime() + bufMs })).sort((a, b) => a.start - b.start);

  const out: Date[] = [];
  const lastKey = zonedDateKey(latest, tz);
  for (let key = zonedDateKey(earliest, tz); key <= lastKey; key = addDaysKey(key, 1)) {
    const [y, m, d] = key.split("-").map(Number);
    for (const [open, close] of rules.availability[weekdayOfKey(key)] ?? []) {
      const closeMin = toMin(close);
      for (let t = toMin(open); t + rules.durationMin + rules.bufferMin <= closeMin; t += step) {
        const start = zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, tz);
        // Skip wall-clock times that don't exist on this day (spring forward).
        const p = zonedParts(start, tz);
        if (p.hour * 60 + p.minute !== t || p.day !== d) continue;
        const s = start.getTime();
        const e = s + durMs;
        if (s < earliest.getTime() || s > latest.getTime()) continue;
        if (blocks.some((b) => b.start < e && b.end > s)) continue;
        if (out.length && out[out.length - 1].getTime() === s) continue; // fall-back repeats
        out.push(start);
      }
    }
  }
  return out;
}

/** Is `start` one of the slots the rules offer right now (used when booking)? */
export function isBookableSlot(rules: SlotRules, busy: Busy[], start: Date, now: Date = new Date()): boolean {
  const from = new Date(start.getTime() - 60_000);
  const to = new Date(start.getTime() + 60_000);
  return computeSlots(rules, busy, { from, to }, now).some((s) => s.getTime() === start.getTime());
}

/** Slots grouped by the date they fall on in `tz` (the visitor's zone for display). */
export function groupSlotsByDay(slots: Date[], tz: string): { date: string; slots: string[] }[] {
  const days = new Map<string, string[]>();
  for (const s of slots) {
    const key = zonedDateKey(s, tz);
    const list = days.get(key) ?? [];
    list.push(s.toISOString());
    days.set(key, list);
  }
  return [...days.entries()].map(([date, list]) => ({ date, slots: list }));
}

export const LOCATION_LABEL: Record<string, string> = {
  phone: "Phone call",
  video: "Video call",
  in_person: "In person",
  custom: "Other",
};
