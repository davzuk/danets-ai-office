import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// GET — return the business's AI agent; create a default if none exists.
export function GET() {
  return withSession(async (user) => {
    let agent = await db.aiAgent.findFirst({
      where: { businessId: user.businessId },
    });

    if (!agent) {
      agent = await db.aiAgent.create({
        data: {
          businessId: user.businessId,
          botName: "Assistant",
          businessName: user.businessName,
          industry: "General",
          welcomeMessage: "Hi! How can I help you today?",
          fallbackMessage:
            "I'm not fully sure about that. Please contact our team for confirmation.",
          handoverMessage:
            "Let me connect you with our team for further assistance.",
          tone: "professional",
          brandColor: "#1d4ed8",
          status: "active",
          leadCaptureEnabled: true,
        },
      });
    }

    return { agent };
  });
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const updateSchema = z.object({
  botName: z.string().min(1).max(60),
  businessName: z.string().min(1).max(120).optional().nullable(),
  industry: z.string().max(80).optional().nullable(),
  welcomeMessage: z.string().min(1).max(500),
  fallbackMessage: z.string().min(1).max(500),
  handoverMessage: z.string().min(1).max(500),
  tone: z.enum(["professional", "friendly", "formal"]),
  contactPhone: z.string().max(40).optional().nullable(),
  whatsappNumber: z.string().max(40).optional().nullable(),
  email: z.union([z.string().email(), z.literal("")]).optional().nullable(),
  brandColor: z
    .string()
    .regex(HEX_COLOR, "Brand color must be a hex color, e.g. #1d4ed8"),
  quickReplies: z.array(z.string().min(1).max(120)).max(8).optional(),
  status: z.enum(["active", "inactive"]),
  leadCaptureEnabled: z.boolean(),
});

// PUT — update the agent for the current business.
// Note: withSession wraps the return as 200 OK JSON. For validation errors we
// throw, which apiHandler turns into a 500 with { error } — the client checks
// res.ok and reads data.error.
export function PUT(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = Object.values(
        parsed.error.flatten().fieldErrors
      ).flat()[0];
      throw new Error(firstError || "Invalid input");
    }

    const data = parsed.data;
    const cleanData = {
      botName: data.botName.trim(),
      businessName: data.businessName?.trim() || null,
      industry: data.industry?.trim() || null,
      welcomeMessage: data.welcomeMessage.trim(),
      fallbackMessage: data.fallbackMessage.trim(),
      handoverMessage: data.handoverMessage.trim(),
      tone: data.tone,
      contactPhone: data.contactPhone?.trim() || null,
      whatsappNumber: data.whatsappNumber?.trim() || null,
      email: data.email && data.email !== "" ? data.email.trim() : null,
      brandColor: data.brandColor,
      quickReplies: JSON.stringify((data.quickReplies || []).filter((q) => q.trim()).slice(0, 8)),
      status: data.status,
      leadCaptureEnabled: data.leadCaptureEnabled,
    };

    const existing = await db.aiAgent.findFirst({
      where: { businessId: user.businessId },
      select: { id: true },
    });

    let agent;
    if (existing) {
      agent = await db.aiAgent.update({
        where: { id: existing.id },
        data: cleanData,
      });
    } else {
      agent = await db.aiAgent.create({
        data: { businessId: user.businessId, ...cleanData },
      });
    }

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "ai_agent_updated",
      module: "agent",
      description: `Updated AI agent "${cleanData.botName}"`,
    });

    return { agent };
  });
}
