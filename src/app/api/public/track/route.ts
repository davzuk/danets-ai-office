import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { parseAttribution, recordVisits } from "@/lib/attribution";
import { logger, serializeError } from "@/lib/logger";

const trackSchema = z.object({
  pk: z.string().min(1).max(191),
  visitorId: z.string().min(1).max(191),
  attribution: z.unknown(),
});

// Cap the body: attribution is a few short strings plus two URLs.
const MAX_BODY_BYTES = 8 * 1024;

/**
 * POST /api/public/track: the embed widget reports the visitor's traffic
 * source once per browser session. Records at most one "visit" touchpoint
 * per (visitor, browser session), so repeat calls are cheap no-ops.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(`track:${ip}`, 60, 10 * 60 * 1000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = trackSchema.safeParse(body);
  const attribution = parsed.success ? parseAttribution(parsed.data.attribution) : null;
  if (!parsed.success || !attribution) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const business = await db.business.findUnique({
    where: { publicKey: parsed.data.pk, status: "active" },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  try {
    const known = await db.contactIdentity.findUnique({
      where: { businessId_type_value: { businessId: business.id, type: "visitor", value: parsed.data.visitorId } },
      select: { contactId: true },
    });
    const touches = await recordVisits({
      businessId: business.id,
      visitorId: parsed.data.visitorId,
      attribution,
      contactId: known?.contactId ?? null,
    });
    if (known) await db.contact.update({ where: { id: known.contactId }, data: { lastSeenAt: new Date() } });
    return NextResponse.json({ ok: true, recorded: touches.length });
  } catch (e) {
    logger.warn("Visit tracking failed", { businessId: business.id, ...serializeError(e) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
