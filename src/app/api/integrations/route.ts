import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";

const CATEGORIES = ["ai_provider", "whatsapp", "email", "sms", "payment", "crm", "website_widget"];

// GET /api/integrations — list all integrations for the business
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const integrations = await db.integration.findMany({
      where: { businessId: user.businessId },
      orderBy: { category: "asc" },
    });

    return {
      integrations: integrations.map((i) => {
        let config: any = null;
        try {
          config = i.config ? JSON.parse(i.config) : null;
        } catch {}
        // Mask any apiKey in config
        if (config?.apiKey) {
          const k = config.apiKey as string;
          config.apiKeyMasked = k.length > 8 ? k.slice(0, 4) + "••••••••" + k.slice(-4) : "••••";
          config.hasApiKey = true;
          delete config.apiKey;
        }
        return {
          id: i.id,
          category: i.category,
          provider: i.provider,
          name: i.name,
          status: i.status,
          config,
          lastTestedAt: i.lastTestedAt?.toISOString() || null,
          notes: i.notes,
          createdAt: i.createdAt.toISOString(),
        };
      }),
    };
  });
}

const upsertSchema = z.object({
  category: z.enum(CATEGORIES as [string, ...string[]]),
  provider: z.string().min(1).max(60),
  name: z.string().min(1).max(100),
  status: z.enum(["active", "inactive", "testing", "error"]).default("inactive"),
  config: z.record(z.string(), z.any()).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

// POST /api/integrations — create or update an integration
export function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const d = parsed.data;
    // Check if integration for this category already exists
    const existing = await db.integration.findFirst({
      where: { businessId: user.businessId, category: d.category },
    });

    const configStr = d.config ? JSON.stringify(d.config) : null;
    let integration;

    if (existing) {
      // Update — but preserve existing apiKey if not provided
      let newConfig = d.config || {};
      if (existing.config) {
        try {
          const oldConfig = JSON.parse(existing.config);
          if (!newConfig.apiKey && oldConfig.apiKey) {
            newConfig.apiKey = oldConfig.apiKey;
          }
        } catch {}
      }
      integration = await db.integration.update({
        where: { id: existing.id },
        data: {
          provider: d.provider,
          name: d.name,
          status: d.status,
          config: Object.keys(newConfig).length > 0 ? JSON.stringify(newConfig) : null,
          notes: d.notes || null,
        },
      });
    } else {
      integration = await db.integration.create({
        data: {
          businessId: user.businessId,
          category: d.category,
          provider: d.provider,
          name: d.name,
          status: d.status,
          config: configStr,
          notes: d.notes || null,
        },
      });
    }

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "integration_changed",
      module: "integrations",
      description: `Updated ${d.category} integration (${d.provider})`,
      metadata: { integrationId: integration.id },
    });

    return { integration: { id: integration.id, category: integration.category, provider: integration.provider, status: integration.status } };
  });
}
