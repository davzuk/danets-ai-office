import { beforeEach, describe, expect, it, vi } from "vitest";

// importMetaLead against fakes: checks idempotency and the email-merge path
// without a database.
const leads = new Map<string, { id: string; businessId: string; email: string | null; externalRef: string | null }>();
const created: Record<string, unknown>[] = [];
const activities: { leadId: string; type: string }[] = [];

const db = {
  lead: {
    findUnique: vi.fn(async ({ where }: { where: Record<string, { businessId: string; externalRef?: string; email?: string }> }) => {
      const key = where.businessId_externalRef ?? where.Lead_businessId_email_key;
      return [...leads.values()].find(
        (l) =>
          l.businessId === key.businessId &&
          (key.externalRef ? l.externalRef === key.externalRef : l.email === key.email)
      ) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `lead${leads.size + 1}`, ...data } as never as { id: string; businessId: string; email: string | null; externalRef: string | null };
      leads.set(row.id, row);
      created.push(data);
      return { quality: "medium", name: "x", service: null, source: "social_paid", ...row };
    }),
    update: vi.fn(async () => ({})),
  },
  leadActivity: { create: vi.fn(async ({ data }: { data: { leadId: string; type: string } }) => activities.push(data)) },
  metaLeadForm: { update: vi.fn(async () => ({})) },
};

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/activity", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/automation", () => ({ fireTrigger: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-quota", () => ({ requireQuota: vi.fn(async () => {}) }));
vi.mock("@/lib/ai-scoring", () => ({ scoreLead: vi.fn(async () => 50) }));
vi.mock("@/lib/attribution", async (orig) => ({
  ...(await orig<typeof import("@/lib/attribution")>()),
  recordTouch: vi.fn(async (args: { channel: string }) => ({ id: "touch1", channel: args.channel })),
}));
vi.mock("@/lib/contacts", async (orig) => ({
  ...(await orig<typeof import("@/lib/contacts")>()),
  resolveContact: vi.fn(async () => ({ contact: { id: "contact1" }, created: true, mergedIds: [] })),
  contactTouchBounds: vi.fn(async () => ({ first: null, last: null })),
}));

const { defaultTarget, importMetaLead, mapLeadFields, metaLeadRef, metaLeadTouch } = await import("@/lib/social/meta-leads");
const { leadFormPatchSchema } = await import("@/lib/social/lead-forms");
const attribution = await import("@/lib/attribution");

describe("mapLeadFields", () => {
  it("maps Meta's standard fields and keeps custom answers as message lines", () => {
    const m = mapLeadFields(
      [
        { name: "first_name", values: ["Ada"] },
        { name: "last_name", values: ["Obi"] },
        { name: "email", values: [" Ada@Example.COM "] },
        { name: "phone_number", values: ["+234 801 234 5678"] },
        { name: "company_name", values: ["Acme"] },
        { name: "which_service_do_you_need?", values: ["Braces"] },
        { name: "budget", values: [""] },
      ],
      {},
      [{ key: "which_service_do_you_need?", label: "Which service do you need?" }]
    );
    expect(m).toEqual({
      name: "Ada Obi",
      email: "ada@example.com",
      phone: "+234 801 234 5678",
      company: "Acme",
      service: null,
      message: "Which service do you need?: Braces",
    });
  });

  it("applies the form's mapping, including ignore and service", () => {
    const m = mapLeadFields(
      [
        { name: "full_name", values: ["Ada Obi"] },
        { name: "treatment", values: ["Whitening", "Check-up"] },
        { name: "how_did_you_hear", values: ["Friend"] },
        { name: "email", values: ["not-an-email"] },
      ],
      { treatment: "service", how_did_you_hear: "ignore" }
    );
    expect(m.service).toBe("Whitening, Check-up");
    expect(m.message).toBeNull();
    expect(m.email).toBeNull();
    expect(m.name).toBe("Ada Obi");
  });

  it("falls back to a humanized key when the form has no label", () => {
    expect(mapLeadFields([{ name: "preferred_day", values: ["Saturday"] }]).message).toBe("Preferred day: Saturday");
  });

  it("defaults unknown keys to the message", () => {
    expect(defaultTarget("work_email")).toBe("email");
    expect(defaultTarget("city")).toBe("message");
  });
});

describe("metaLeadTouch", () => {
  it("tags paid and organic leads and the platform", () => {
    expect(metaLeadTouch({ is_organic: false, platform: "ig", campaign_name: "Spring", ad_name: "Ad 1", adset_name: "Lagos" })).toEqual({
      channel: "social_paid",
      touch: { source: "instagram", medium: "paid_social", campaign: "Spring", term: "Lagos", content: "Ad 1" },
    });
    expect(metaLeadTouch({ is_organic: true, platform: "fb" }).channel).toBe("social_organic");
  });
});

describe("leadFormPatchSchema", () => {
  it("accepts known targets only", () => {
    expect(leadFormPatchSchema.safeParse({ fieldMapping: { q1: "service" } }).success).toBe(true);
    expect(leadFormPatchSchema.safeParse({ fieldMapping: { q1: "password" } }).success).toBe(false);
    expect(leadFormPatchSchema.safeParse({}).success).toBe(false);
    expect(leadFormPatchSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
  });
});

describe("importMetaLead", () => {
  const account = { id: "sa1", businessId: "b1", name: "Acme Dental" };
  const form = { id: "f1", formId: "F1", name: "Book a check-up", enabled: true, fieldMapping: null, questions: [] };
  const lead = (id: string, email = "ada@example.com") => ({
    id,
    form_id: "F1",
    created_time: "2026-11-20T10:00:00+0000",
    campaign_name: "Spring",
    ad_name: "Ad 1",
    is_organic: false,
    platform: "fb",
    field_data: [
      { name: "full_name", values: ["Ada Obi"] },
      { name: "email", values: [email] },
    ],
  });

  beforeEach(() => {
    leads.clear();
    created.length = 0;
    activities.length = 0;
    vi.clearAllMocks();
  });

  it("creates one lead with the ad touch, then treats replays as duplicates", async () => {
    const first = await importMetaLead(account, form, lead("L1"));
    expect(first.status).toBe("created");
    expect(created[0]).toMatchObject({
      externalRef: metaLeadRef("L1"),
      source: "social_paid",
      email: "ada@example.com",
      service: "Book a check-up",
      firstTouchId: "touch1",
    });
    expect(attribution.recordTouch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ad_lead", dedupeKey: "meta-lead:L1", touch: expect.objectContaining({ campaign: "Spring", content: "Ad 1" }) })
    );

    const again = await importMetaLead(account, form, lead("L1"));
    expect(again).toEqual({ status: "duplicate", leadId: "lead1" });
    expect(created).toHaveLength(1);
  });

  it("adds a repeat submission by a known email to the existing lead", async () => {
    await importMetaLead(account, form, lead("L1"));
    const second = await importMetaLead(account, form, lead("L2"));
    expect(second).toEqual({ status: "merged", leadId: "lead1" });
    expect(created).toHaveLength(1);
    expect(activities.map((a) => a.type)).toEqual(["lead_created", "lead_updated"]);
  });

  it("skips disabled forms", async () => {
    expect(await importMetaLead(account, { ...form, enabled: false }, lead("L3"))).toEqual({ status: "skipped", reason: "form_disabled" });
    expect(created).toHaveLength(0);
  });
});
