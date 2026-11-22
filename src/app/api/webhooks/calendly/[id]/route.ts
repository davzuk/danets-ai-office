import { NextRequest, NextResponse } from "next/server";
import { logger, serializeError } from "@/lib/logger";
import { isModuleEnabled } from "@/lib/module-access";
import { parseCalendlyWebhook, verifyCalendlySignature } from "@/lib/booking/calendly";
import { calendlyWebhookSecret } from "@/lib/booking/calendly-connection";
import { recordCalendlyBooking } from "@/lib/booking/service";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/webhooks/calendly/<integrationId>  Calendly invitee events for
 * one tenant's connection, signed with that connection's signing key.
 * A failure returns 500 so Calendly retries; repeats are ignored.
 */
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params;
  const conn = await calendlyWebhookSecret(id);
  if (!conn) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 });

  const raw = await req.text();
  if (!verifyCalendlySignature(req.headers.get("calendly-webhook-signature"), raw, conn.signingKey)) {
    logger.warn("Calendly webhook rejected: bad signature", { integrationId: id });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const invitee = parseCalendlyWebhook(body);
  if (!invitee) return NextResponse.json({ ok: true, ignored: true });

  // A tenant that dropped below Pro keeps the link but stops syncing.
  if (!(await isModuleEnabled(conn.businessId, "booking_sync"))) return NextResponse.json({ ok: true, ignored: "plan" });

  try {
    const result = await recordCalendlyBooking(conn.businessId, invitee);
    return NextResponse.json({ ok: true, ...(result ?? {}) });
  } catch (e) {
    logger.error("Calendly webhook failed", { integrationId: id, event: invitee.event, ...serializeError(e) });
    return NextResponse.json({ error: "Could not record the booking" }, { status: 500 });
  }
}
