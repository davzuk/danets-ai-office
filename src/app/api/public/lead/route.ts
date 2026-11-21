import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";
import { requireQuota, LimitExceededError } from "@/lib/plan-quota";
import { captureInbound } from "@/lib/inbound-attribution";
import { leadSourceFromChannel } from "@/lib/attribution";

const leadSchema = z.object({
  pk: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  name: z.string().min(2).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  service: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  visitorId: z.string().max(191).nullable().optional(),
  // Validated (and size-capped) by captureInbound; bad attribution never rejects a lead.
  attribution: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`lead:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many submissions." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const { pk, sessionId, name, email, phone, service, message, attribution } = parsed.data;

  const business = await db.business.findUnique({
    where: { publicKey: pk, status: "active" },
  });
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  // Basic quality heuristic
  let quality: "low" | "medium" | "high" = "medium";
  const signals = [email, phone, service, message].filter(Boolean).length;
  if (signals >= 3 && (service || message)) quality = "high";
  if (signals <= 1) quality = "low";

  // Verify session belongs to this business if provided
  let validSessionId: string | undefined;
  let sessionVisitorId: string | null = null;
  if (sessionId) {
    const s = await db.chatSession.findFirst({
      where: { id: sessionId, businessId: business.id },
    });
    if (s) {
      validSessionId = s.id;
      sessionVisitorId = s.visitorId;
    }
  }

  // Unified contact + touchpoints (first touch drives Lead.source).
  // Recorded even when the lead turns out to be a duplicate: a returning
  // visitor submitting again is a real touch on the same contact.
  const inbound = await captureInbound({
    businessId: business.id,
    kind: "form_submit",
    visitorId: parsed.data.visitorId || sessionVisitorId,
    attribution,
    profile: { name, email, phone },
  });
  const contactId = inbound?.contactId ?? null;
  const linkExisting = async (leadId: string) => {
    if (contactId) {
      await db.lead.updateMany({ where: { id: leadId, contactId: null }, data: { contactId } });
    }
  };

  // Prevent duplicate leads from same session.
  if (validSessionId) {
    const existing = await db.lead.findUnique({
      where: { sessionId: validSessionId },
    });
    if (existing) {
      await linkExisting(existing.id);
      return NextResponse.json({
        leadId: existing.id,
        alreadyExists: true,
        quality: existing.quality,
      });
    }
  }

  // Prevent duplicate leads by (businessId, email). The unique index
  // `Lead_businessId_email_key` enforces this at the DB layer; we do a
  // best-effort pre-check so we don't burn a quota slot on a submission
  // that would be rejected with P2002 anyway. The defensive catch around
  // `db.lead.create` below handles concurrent inserts (a race between
  // two tabs both reading "no existing lead" then both inserting).
  const normalisedEmail = email?.trim().toLowerCase() || null;
  if (normalisedEmail) {
    const existing = await db.lead.findUnique({
      where: {
        Lead_businessId_email_key: {
          businessId: business.id,
          email: normalisedEmail,
        },
      },
    });
    if (existing) {
      await linkExisting(existing.id);
      return NextResponse.json({
        leadId: existing.id,
        alreadyExists: true,
        quality: existing.quality,
      });
    }
  }

  try {
    await requireQuota(business.id, "leads");
  } catch (e) {
    if (e instanceof LimitExceededError) {
      return NextResponse.json(
        { error: "Lead capture limit reached for this business." },
        { status: 429 }
      );
    }
    throw e;
  }

  let lead;
  try {
    lead = await db.lead.create({
      data: {
        businessId: business.id,
        sessionId: validSessionId,
        name,
        email: normalisedEmail,
        phone: phone || null,
        service: service || null,
        message: message || null,
        quality,
        status: "new",
        source: inbound?.attributed ? leadSourceFromChannel(inbound.channel) : "chatbot",
        contactId,
        firstTouchId: inbound?.firstTouch.id ?? null,
        lastTouchId: inbound?.touch.id ?? null,
      },
    });
  } catch (e: any) {
    // P2002 = unique constraint violation. If a concurrent request
    // inserted the same (businessId, email) between our pre-check and
    // our create, fall back to fetching that row and reporting it as
    // `alreadyExists` so the client UX stays consistent.
    if (e?.code === "P2002" && normalisedEmail) {
      const existing = await db.lead.findUnique({
        where: {
          Lead_businessId_email_key: {
            businessId: business.id,
            email: normalisedEmail,
          },
        },
      });
      if (existing) {
        await linkExisting(existing.id);
        return NextResponse.json({
          leadId: existing.id,
          alreadyExists: true,
          quality: existing.quality,
        });
      }
    }
    throw e;
  }

  // Update session visitor info if linked
  if (validSessionId) {
    await db.chatSession.update({
      where: { id: validSessionId },
      data: {
        visitorName: name,
        visitorEmail: email || undefined,
        visitorPhone: phone || undefined,
        leadQuality: quality,
        ...(contactId ? { contactId } : {}),
      },
    });
  }

  // Create notification for the business
  const notifType = quality === "high" ? "high_quality_lead" : "new_lead";
  await createNotification({
    businessId: business.id,
    type: notifType,
    title: quality === "high" ? "High quality lead captured!" : "New lead captured",
    message: `${name}${service ? ` — ${service}` : ""} (${quality} quality)`,
    data: { leadId: lead.id, quality, source: lead.source },
  });

  // Fire automation triggers
  await fireTrigger("new_lead", {
    businessId: business.id,
    leadId: lead.id,
    leadName: lead.name,
  });

  // Auto-score the lead using AI (non-blocking)
  import("@/lib/ai-scoring")
    .then(({ scoreLead }) => scoreLead(lead.id, business.id))
    .catch(() => {});

  return NextResponse.json({ leadId: lead.id, quality: lead.quality });
}
