import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// GET /api/whatsapp/integration — get WhatsApp integration settings
// NEVER returns the apiKey to the frontend (masked).
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    let integration = await db.whatsAppIntegration.findFirst({
      where: { businessId: user.businessId },
    });

    // Create default if none exists
    if (!integration) {
      integration = await db.whatsAppIntegration.create({
        data: {
          businessId: user.businessId,
          provider: "manual",
          status: "inactive",
        },
      });
    }

    return {
      integration: {
        id: integration.id,
        provider: integration.provider,
        phoneNumber: integration.phoneNumber,
        phoneNumberId: integration.phoneNumberId,
        hasApiKey: !!integration.apiKey,
        apiKeyMasked: integration.apiKey
          ? integration.apiKey.slice(0, 4) + "••••••••" + integration.apiKey.slice(-4)
          : null,
        webhookUrl: integration.webhookUrl,
        status: integration.status,
        lastTestedAt: integration.lastTestedAt?.toISOString() || null,
        notes: integration.notes,
      },
    };
  });
}

const PROVIDERS = ["manual", "meta_cloud_api", "twilio", "termii", "other"];

const updateSchema = z.object({
  provider: z.enum(PROVIDERS as [string, ...string[]]).optional(),
  phoneNumber: z.string().max(40).optional().nullable(),
  phoneNumberId: z.string().max(200).optional().nullable(),
  apiKey: z.string().max(500).optional().nullable(),
  webhookUrl: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// PUT /api/whatsapp/integration — update integration settings
export function PUT(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const data: any = {};
    if (parsed.data.provider) data.provider = parsed.data.provider;
    if (parsed.data.phoneNumber !== undefined) data.phoneNumber = parsed.data.phoneNumber || null;
    if (parsed.data.phoneNumberId !== undefined) data.phoneNumberId = parsed.data.phoneNumberId || null;
    if (parsed.data.apiKey !== undefined) data.apiKey = parsed.data.apiKey || null;
    if (parsed.data.webhookUrl !== undefined) data.webhookUrl = parsed.data.webhookUrl || null;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes || null;

    let integration = await db.whatsAppIntegration.findFirst({
      where: { businessId: user.businessId },
    });

    if (integration) {
      integration = await db.whatsAppIntegration.update({
        where: { id: integration.id },
        data,
      });
    } else {
      integration = await db.whatsAppIntegration.create({
        data: { businessId: user.businessId, ...data },
      });
    }

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "integration_changed",
      module: "integrations",
      description: `Updated WhatsApp integration (provider: ${integration.provider})`,
    });

    return {
      integration: {
        id: integration.id,
        provider: integration.provider,
        phoneNumber: integration.phoneNumber,
        phoneNumberId: integration.phoneNumberId,
        hasApiKey: !!integration.apiKey,
        webhookUrl: integration.webhookUrl,
        status: integration.status,
        notes: integration.notes,
      },
    };
  });
}
