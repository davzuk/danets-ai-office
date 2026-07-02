import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";

const leadSchema = z.object({
  pk: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  name: z.string().min(2).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  service: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`lead:${ip}`, 10, 10 * 60 * 1000);
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

  const { pk, sessionId, name, email, phone, service, message } = parsed.data;

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
  if (sessionId) {
    const s = await db.chatSession.findFirst({
      where: { id: sessionId, businessId: business.id },
    });
    if (s) validSessionId = s.id;
  }

  // Prevent duplicate leads from same session
  if (validSessionId) {
    const existing = await db.lead.findUnique({
      where: { sessionId: validSessionId },
    });
    if (existing) {
      return NextResponse.json({
        leadId: existing.id,
        alreadyExists: true,
        quality: existing.quality,
      });
    }
  }

  const lead = await db.lead.create({
    data: {
      businessId: business.id,
      sessionId: validSessionId,
      name,
      email: email || null,
      phone: phone || null,
      service: service || null,
      message: message || null,
      quality,
      status: "new",
      source: "chatbot",
    },
  });

  // Update session visitor info if linked
  if (validSessionId) {
    await db.chatSession.update({
      where: { id: validSessionId },
      data: {
        visitorName: name,
        visitorEmail: email || undefined,
        visitorPhone: phone || undefined,
        leadQuality: quality,
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
