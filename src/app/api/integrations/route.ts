import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { requireQuota } from "@/lib/plan-quota";
import {
  decryptApiKey,
  encryptApiKey,
  isEncryptedPayload,
  maskApiKey,
} from "@/lib/crypto";
import { clearAiProviderCache } from "@/lib/llm/resolve";

const CATEGORIES = ["ai_provider", "whatsapp", "email", "sms", "payment", "crm", "website_widget"];

// GET /api/integrations — list all integrations for the business
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const integrations = await db.integration.findMany({
      // Booking connections (Calendly) are managed in Leads -> Bookings.
      where: { businessId: user.businessId, category: { not: "booking" } },
      orderBy: { category: "asc" },
    });

    // Rows that need a one-shot re-encryption from legacy plaintext into
    // the encrypted envelope. Collected during the read pass and written
    // atomically after the loop so a single read cycle repairs the column
    // without spawning a separate migration script.
    const toReencrypt: { id: string; config: string }[] = [];

    const out = integrations.map((i) => {
      let config: Record<string, any> | null = null;
      try {
        config = i.config ? JSON.parse(i.config) : null;
      } catch {}
      if (!config) config = {};

      let cleartext: string | null = null;
      const apiKeyField = config.apiKey;
      if (apiKeyField == null) {
        cleartext = null;
      } else if (isEncryptedPayload(apiKeyField)) {
        cleartext = decryptApiKey(apiKeyField);
      } else if (typeof apiKeyField === "string" && apiKeyField.length > 0) {
        // Legacy plaintext row — upgrade in place below.
        cleartext = apiKeyField;
        config.apiKey = undefined;
        toReencrypt.push({ id: i.id, config: JSON.stringify(config) });
      }

      // Re-mask for the response so the cleartext never leaves the server.
      if (cleartext) {
        config.apiKeyMasked = maskApiKey(cleartext);
        config.hasApiKey = true;
        delete config.apiKey;
      } else {
        config.hasApiKey = false;
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
    });

    if (toReencrypt.length > 0) {
      await db.$transaction(
        toReencrypt.map((row) =>
          db.integration.update({
            where: { id: row.id },
            data: { config: row.config },
          })
        )
      );
    }

    return { integrations: out };
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

    let integration;

    if (existing) {
      // Update only — no quota check needed for existing rows
    } else {
      await requireQuota(user.businessId, "integrations");
    }

    // Seal any plaintext apiKey the caller passed in. We never persist a
    // cleartext secret: the body is either an encrypted envelope (already
    // encrypted from a prior round-trip), an empty string (preserve old),
    // or a fresh plaintext that we encrypt here.
    const sealIncoming = (
      cfg: Record<string, any> | null | undefined
    ): Record<string, any> | null => {
      if (!cfg) return cfg || null;
      const out = { ...cfg };
      const key = out.apiKey;
      if (typeof key === "string" && key.length > 0 && !isEncryptedPayload(key)) {
        out.apiKey = encryptApiKey(key);
      }
      return out;
    };

    if (existing) {
      // Update — but preserve existing apiKey if not provided
      let newConfig = d.config || {};
      if (existing.config) {
        try {
          const oldConfig = JSON.parse(existing.config);
          if (!newConfig.apiKey && oldConfig.apiKey) {
            // Keep whatever's already on disk — encrypted envelope or legacy
            // plaintext both round-trip through this branch untouched. The
            // GET path is responsible for upgrading legacy plaintext rows.
            newConfig.apiKey = oldConfig.apiKey;
          }
        } catch {}
      }
      newConfig = sealIncoming(newConfig) || {};
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
      const sealed = sealIncoming(d.config);
      integration = await db.integration.create({
        data: {
          businessId: user.businessId,
          category: d.category,
          provider: d.provider,
          name: d.name,
          status: d.status,
          config: sealed && Object.keys(sealed).length > 0 ? JSON.stringify(sealed) : null,
          notes: d.notes || null,
        },
      });
    }

    if (d.category === "ai_provider") clearAiProviderCache(user.businessId);

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
