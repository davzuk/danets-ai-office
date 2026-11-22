import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { computeSlots, isBookableSlot, availabilitySchema, bookingTypeInputSchema, groupSlotsByDay, DEFAULT_AVAILABILITY, addDaysKey } = await import("@/lib/booking/slots");
const { buildIcs, foldLine, icsEscape } = await import("@/lib/booking/ics");
const { visitorEmail, businessEmail } = await import("@/lib/booking/emails");
const { detectBookingIntent } = await import("@/lib/agent-reply");
const { toPublicRules, widgetRuleInputSchema } = await import("@/lib/widget-rules");

type Rules = Parameters<typeof computeSlots>[0];
const none = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } as Rules["availability"];

const rules = (over: Partial<Rules> = {}): Rules => ({
  availability: DEFAULT_AVAILABILITY,
  timezone: "Europe/London",
  durationMin: 30,
  bufferMin: 0,
  minNoticeHours: 0,
  maxDaysAhead: 30,
  slotStepMin: 30,
  ...over,
});

const iso = (d: Date[]) => d.map((x) => x.toISOString());
// Monday 4 January 2027 (London is on GMT, so local = UTC).
const MON = { from: new Date("2027-01-04T00:00:00Z"), to: new Date("2027-01-05T00:00:00Z") };
const NOW = new Date("2027-01-01T00:00:00Z");

describe("computeSlots", () => {
  it("offers every step inside the day's hours", () => {
    const s = computeSlots(rules(), [], MON, NOW);
    expect(s).toHaveLength(16);
    expect(s[0].toISOString()).toBe("2027-01-04T09:00:00.000Z");
    expect(s[15].toISOString()).toBe("2027-01-04T16:30:00.000Z");
  });

  it("needs the meeting plus its buffer to fit before closing", () => {
    const s = computeSlots(rules({ bufferMin: 15 }), [], MON, NOW);
    expect(s.at(-1)!.toISOString()).toBe("2027-01-04T16:00:00.000Z");
    expect(s).toHaveLength(15);
  });

  it("skips busy times, padded by the buffer", () => {
    const busy = [{ start: new Date("2027-01-04T10:00:00Z"), end: new Date("2027-01-04T10:30:00Z") }];
    const plain = iso(computeSlots(rules(), busy, MON, NOW));
    expect(plain).not.toContain("2027-01-04T10:00:00.000Z");
    expect(plain).toContain("2027-01-04T09:30:00.000Z");
    expect(plain).toContain("2027-01-04T10:30:00.000Z");
    const padded = iso(computeSlots(rules({ bufferMin: 15 }), busy, MON, NOW));
    for (const t of ["09:30", "10:00", "10:30"]) expect(padded).not.toContain(`2027-01-04T${t}:00.000Z`);
    expect(padded).toContain("2027-01-04T11:00:00.000Z");
  });

  it("respects minimum notice and the booking horizon", () => {
    const s = computeSlots(rules({ minNoticeHours: 1 }), [], MON, new Date("2027-01-04T08:50:00Z"));
    expect(s[0].toISOString()).toBe("2027-01-04T10:00:00.000Z");
    expect(computeSlots(rules({ maxDaysAhead: 2 }), [], MON, NOW)).toEqual([]);
  });

  it("returns nothing on closed days", () => {
    const sat = { from: new Date("2027-01-02T00:00:00Z"), to: new Date("2027-01-03T00:00:00Z") };
    expect(computeSlots(rules(), [], sat, NOW)).toEqual([]);
  });

  it("keeps wall-clock hours across daylight saving (London summer time)", () => {
    const july = { from: new Date("2027-07-05T00:00:00Z"), to: new Date("2027-07-06T00:00:00Z") };
    const s = computeSlots(rules(), [], july, new Date("2027-06-20T00:00:00Z"));
    expect(s[0].toISOString()).toBe("2027-07-05T08:00:00.000Z"); // 09:00 BST
  });

  it("drops times that don't exist when clocks spring forward (New York)", () => {
    const r = rules({ timezone: "America/New_York", durationMin: 60, slotStepMin: 60, availability: { ...none, sun: [["01:00", "04:00"]] } });
    const day = { from: new Date("2026-03-08T00:00:00Z"), to: new Date("2026-03-09T12:00:00Z") };
    const s = computeSlots(r, [], day, new Date("2026-03-01T00:00:00Z"));
    expect(iso(s)).toEqual(["2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z"]); // 01:00 EST, 03:00 EDT
  });

  it("never repeats a time when clocks fall back (New York)", () => {
    const r = rules({ timezone: "America/New_York", durationMin: 60, slotStepMin: 60, availability: { ...none, sun: [["00:00", "03:00"]] } });
    const day = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-02T12:00:00Z") };
    const s = computeSlots(r, [], day, new Date("2026-10-25T00:00:00Z"));
    expect(s).toHaveLength(3);
    expect(new Set(iso(s)).size).toBe(3);
    for (let i = 1; i < s.length; i++) expect(s[i].getTime()).toBeGreaterThan(s[i - 1].getTime());
  });
});

describe("isBookableSlot", () => {
  it("accepts offered slots only", () => {
    const busy = [{ start: new Date("2027-01-04T11:00:00Z"), end: new Date("2027-01-04T11:30:00Z") }];
    expect(isBookableSlot(rules(), busy, new Date("2027-01-04T10:00:00Z"), NOW)).toBe(true);
    expect(isBookableSlot(rules(), busy, new Date("2027-01-04T10:15:00Z"), NOW)).toBe(false); // off the step
    expect(isBookableSlot(rules(), busy, new Date("2027-01-04T11:00:00Z"), NOW)).toBe(false); // taken
    expect(isBookableSlot(rules(), busy, new Date("2027-01-04T08:00:00Z"), NOW)).toBe(false); // before opening
  });
});

describe("availability and booking type input", () => {
  it("rejects overlapping or backwards hours", () => {
    expect(availabilitySchema.safeParse({ ...none, mon: [["09:00", "12:00"], ["11:00", "15:00"]] }).success).toBe(false);
    expect(availabilitySchema.safeParse({ ...none, mon: [["12:00", "09:00"]] }).success).toBe(false);
    expect(availabilitySchema.safeParse({ ...none, mon: [["9:00", "12:00"]] }).success).toBe(false);
    expect(availabilitySchema.safeParse({ ...none, mon: [["13:00", "17:00"], ["09:00", "12:00"]] }).success).toBe(true);
    expect(availabilitySchema.safeParse({ ...none, fri: [["18:00", "24:00"]] }).success).toBe(true);
  });

  it("validates slugs and applies defaults", () => {
    const base = { name: "Consultation", slug: "Free-Consult", durationMin: 30, availability: DEFAULT_AVAILABILITY };
    const ok = bookingTypeInputSchema.parse(base);
    expect(ok.slug).toBe("free-consult");
    expect(ok.minNoticeHours).toBe(4);
    expect(ok.questions).toEqual([]);
    expect(bookingTypeInputSchema.safeParse({ ...base, slug: "free consult" }).success).toBe(false);
    expect(bookingTypeInputSchema.safeParse({ ...base, questions: [{ key: "Bad Key", label: "x" }] }).success).toBe(false);
  });

  it("groups slots by the visitor's day", () => {
    const slots = [new Date("2027-01-04T23:30:00Z"), new Date("2027-01-05T00:30:00Z")];
    expect(groupSlotsByDay(slots, "UTC").map((g) => g.date)).toEqual(["2027-01-04", "2027-01-05"]);
    expect(groupSlotsByDay(slots, "Asia/Tokyo").map((g) => g.date)).toEqual(["2027-01-05"]);
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("calendar invites", () => {
  const event = {
    uid: "bk1@danets-booking",
    sequence: 2,
    start: new Date("2027-01-04T10:00:00Z"),
    end: new Date("2027-01-04T10:30:00Z"),
    summary: "Consult; with Acme, Ltd",
    description: "Line one\nLine two with a long tail ".repeat(4),
    organizer: { name: 'Acme "Co"', email: "team@acme.test" },
    attendee: { name: "Ada", email: "ada@example.test" },
    method: "REQUEST" as const,
    now: new Date("2027-01-01T00:00:00Z"),
  };

  it("builds a valid, folded VEVENT", () => {
    const ics = buildIcs(event);
    expect(ics.endsWith("\r\n")).toBe(true);
    const lines = ics.split("\r\n");
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DTSTART:20270104T100000Z");
    expect(unfolded).toContain("SEQUENCE:2");
    expect(unfolded).toContain("SUMMARY:Consult\\; with Acme\\, Ltd");
    expect(unfolded).toContain("STATUS:CONFIRMED");
    expect(unfolded).toContain('ORGANIZER;CN="Acme Co":mailto:team@acme.test');
    expect(buildIcs({ ...event, method: "CANCEL" })).toContain("STATUS:CANCELLED");
  });

  it("escapes text and folds multi-byte characters safely", () => {
    expect(icsEscape("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
    const long = "DESCRIPTION:" + "é".repeat(60);
    const folded = foldLine(long);
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
});

describe("booking emails", () => {
  const data = {
    bookingId: "bk1",
    sequence: 0,
    businessName: "Acme <b>Ltd</b>",
    businessEmail: "team@acme.test",
    typeName: "Consult\nBcc: x@evil.test",
    location: "video",
    locationDetail: "https://meet.example.test/abc",
    startsAt: new Date("2027-01-04T10:00:00Z"),
    endsAt: new Date("2027-01-04T10:30:00Z"),
    businessTimezone: "Europe/London",
    visitorTimezone: "America/New_York",
    name: "<script>alert(1)</script>",
    email: "ada@example.test",
    phone: null,
    notes: "Hello & welcome",
    answers: [{ label: "Budget", value: "<img src=x>" }],
    manageUrl: "https://app.example.test/book/manage/tok",
    dashboardUrl: "https://app.example.test/app?view=leads",
  };

  it("escapes values and keeps subjects on one line", () => {
    const v = visitorEmail("confirmed", data);
    expect(v.html).not.toContain("<script>");
    expect(v.html).toContain("&lt;script&gt;");
    expect(v.subject).not.toMatch(/[\r\n]/);
    expect(v.html).toContain("(America/New_York)"); // the visitor's zone
    expect(v.text).toContain("Reschedule or cancel: https://app.example.test/book/manage/tok");
    const b = businessEmail("confirmed", data);
    expect(b.html).not.toContain("<img");
    expect(b.html).toContain("(Europe/London)");
    expect(visitorEmail("cancelled", data).html).not.toContain("Reschedule or cancel");
  });

  it("says who cancelled", () => {
    expect(businessEmail("cancelled", data, "visitor").text).toContain("cancelled their");
    expect(businessEmail("cancelled", data, "business").text).toContain("was cancelled");
  });
});

describe("booking intent and the widget rule action", () => {
  it("spots requests to book, without false matches", () => {
    for (const m of ["Can I book a consultation?", "I'd like to schedule a demo", "Do you have availability on Friday?", "Please call back tomorrow", "Is there a meeting slot?"]) {
      expect(detectBookingIntent(m)).toBe(true);
    }
    for (const m of ["What are your prices?", "I found you on Facebook", "Is the notebook in stock?"]) {
      expect(detectBookingIntent(m)).toBe(false);
    }
  });

  it("passes the booking action through to the widget", () => {
    const input = widgetRuleInputSchema.parse({ name: "Offer times", conditions: {}, message: "Want to book a call?", action: "booking" });
    expect(input.action).toBe("booking");
    const [pub] = toPublicRules([{ id: "r1", enabled: true, priority: 0, conditions: input.conditions, message: input.message, quickReplies: [], action: "booking", frequency: "session", createdAt: new Date() }]);
    expect(pub.action).toBe("booking");
  });
});
