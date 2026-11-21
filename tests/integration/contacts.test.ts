// Contact resolution, merge and backfill against a real MySQL database.
//
// Opt-in, same database as the queue tests (it creates and deletes its own
// throwaway Business):
//   JOBS_TEST_DATABASE_URL="mysql://user:pass@localhost:3306/danets_test" npm run test:db
// The target database must have migrations applied (prisma migrate deploy).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.JOBS_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("contacts + attribution (MySQL)", () => {
  let db: typeof import("@/lib/db").db;
  let contacts: typeof import("@/lib/contacts");
  let inbound: typeof import("@/lib/inbound-attribution");
  let backfill: typeof import("@/lib/contacts-backfill");
  let businessId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    contacts = await import("@/lib/contacts");
    inbound = await import("@/lib/inbound-attribution");
    backfill = await import("@/lib/contacts-backfill");
    const b = await db.business.create({ data: { name: `contacts-test-${Date.now()}`, email: `contacts-test-${Date.now()}@example.com`, plan: "free", status: "active" } });
    businessId = b.id;
  });

  afterAll(async () => {
    if (businessId) await db.business.delete({ where: { id: businessId } }); // cascades
    await db.$disconnect();
  });

  it("utm visit → chat → lead form yields one contact with a paid-social first touch", async () => {
    const visitorId = "v_flow";
    const first = {
      sessionId: "s_flow",
      source: "facebook",
      campaign: "bf26",
      landingUrl: "https://shop.example.com/?utm_source=facebook&utm_campaign=bf26",
    };
    const attribution = { first, last: first };

    const chat = await inbound.captureInbound({
      businessId,
      kind: "chat_start",
      visitorId,
      attribution,
      createContact: "identified",
    });
    expect(chat?.contactId).toBeNull(); // anonymous until they leave details

    const lead = await inbound.captureInbound({
      businessId,
      kind: "form_submit",
      visitorId,
      attribution,
      profile: { name: "Ada", email: "ADA@example.com" },
    });
    expect(lead?.contactId).toBeTruthy();
    expect(lead?.attributed).toBe(true);
    expect(lead?.channel).toBe("social_paid");
    expect(lead?.firstTouch.campaign).toBe("bf26");
    expect(lead?.firstTouch.kind).toBe("visit");

    const touches = await db.touchpoint.findMany({ where: { businessId, visitorId }, orderBy: { occurredAt: "asc" } });
    expect(touches.map((t) => t.kind).sort()).toEqual(["chat_start", "form_submit", "visit"]);
    expect(touches.every((t) => t.contactId === lead!.contactId)).toBe(true); // earlier anonymous touches attached

    // Returning visitor on another device, same email → same contact.
    const again = await inbound.captureInbound({
      businessId,
      kind: "form_submit",
      visitorId: "v_other_device",
      profile: { name: "Ada L", email: "ada@example.com" },
    });
    expect(again?.contactId).toBe(lead?.contactId);
    expect(await db.contact.count({ where: { businessId, email: "ada@example.com" } })).toBe(1);
  });

  it("merges two contacts that turn out to be the same person", async () => {
    const byPhone = await contacts.resolveContact({ businessId, identities: [], profile: { name: "Bo", phone: "+1 555 010 1000" } });
    const byEmail = await contacts.resolveContact({ businessId, identities: [], profile: { email: "bo@example.com" } });
    expect(byPhone!.contact.id).not.toBe(byEmail!.contact.id);
    const lead = await db.lead.create({ data: { businessId, name: "Bo", email: "bo@example.com", contactId: byEmail!.contact.id } });

    const merged = await contacts.resolveContact({
      businessId,
      identities: [],
      profile: { email: "bo@example.com", phone: "+15550101000" },
    });
    expect(merged!.contact.id).toBe(byPhone!.contact.id); // oldest survives
    expect(merged!.mergedIds).toEqual([byEmail!.contact.id]);
    expect(merged!.contact).toMatchObject({ name: "Bo", email: "bo@example.com", phone: "+15550101000" });
    expect((await db.lead.findUnique({ where: { id: lead.id } }))!.contactId).toBe(byPhone!.contact.id);
    expect(await db.contact.findUnique({ where: { id: byEmail!.contact.id } })).toBeNull();
  });

  it("does not merge two people who shared a browser", async () => {
    const a = await contacts.resolveContact({ businessId, identities: [{ type: "visitor", value: "v_shared" }], profile: { email: "cy@example.com" } });
    const b = await contacts.resolveContact({ businessId, identities: [{ type: "visitor", value: "v_shared" }], profile: { email: "di@example.com" } });
    expect(b!.contact.id).not.toBe(a!.contact.id);
  });

  it("resolves concurrent first contacts for one email to a single contact", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => contacts.resolveContact({ businessId, identities: [], profile: { email: "race@example.com" } }))
    );
    expect(new Set(results.map((r) => r!.contact.id)).size).toBe(1);
  });

  it("backfill links existing rows and is idempotent", async () => {
    await db.lead.createMany({
      data: [
        { businessId, name: "Eve", email: "eve@example.com" },
        { businessId, name: "Nobody" }, // no identity: left unlinked
      ],
    });
    await db.supportTicket.create({ data: { businessId, subject: "Help", description: "x", customerEmail: "EVE@example.com" } });

    const first = await backfill.backfillContacts({ businessId });
    expect(first.leads.linked).toBeGreaterThanOrEqual(1);
    expect(first.leads.skipped).toBe(1);
    expect(first.supportTickets.linked).toBe(1);
    const countAfterFirst = await db.contact.count({ where: { businessId } });

    const second = await backfill.backfillContacts({ businessId });
    expect(second.leads.linked).toBe(0);
    expect(second.supportTickets.scanned).toBe(0);
    expect(second.leads.contactsCreated + second.supportTickets.contactsCreated).toBe(0);
    expect(await db.contact.count({ where: { businessId } })).toBe(countAfterFirst);

    const eve = await db.contact.findFirst({ where: { businessId, email: "eve@example.com" }, include: { leads: true, supportTickets: true } });
    expect(eve?.leads).toHaveLength(1);
    expect(eve?.supportTickets).toHaveLength(1);
  });
});
