import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/webhook-signatures";
import { enqueue } from "@/lib/jobs/queue";
import { metaWebhookJob } from "@/lib/jobs/handlers/meta-webhook";
import { logger, serializeError } from "@/lib/logger";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ provider: string }> };

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * GET /api/webhooks/meta — Meta's subscription handshake.
 * Echoes hub.challenge when hub.verify_token matches META_WEBHOOK_VERIFY_TOKEN.
 */
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const { provider } = await params;
  if (provider !== "meta") return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const q = req.nextUrl.searchParams;
  if (
    expected &&
    q.get("hub.mode") === "subscribe" &&
    safeEqual(q.get("hub.verify_token") ?? "", expected)
  ) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/**
 * POST /api/webhooks/meta — verified deliveries are queued and acknowledged
 * immediately; processing happens in the `webhooks.meta` job.
 */
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { provider } = await params;
  if (provider !== "meta") return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "Meta is not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    logger.warn("Meta webhook rejected: bad signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Meta retries deliveries it thinks failed; the body hash makes re-sends idempotent.
    const dedupeKey = `webhook:meta:${createHash("sha256").update(raw).digest("hex")}`;
    await enqueue(metaWebhookJob, body as never, { dedupeKey });
  } catch (e) {
    // A payload that doesn't match the schema will never process; acknowledge
    // so Meta stops retrying, but log it.
    if ((e as Error)?.name === "ZodError") {
      logger.warn("Meta webhook payload not understood", serializeError(e));
      return NextResponse.json({ ok: true, ignored: true });
    }
    logger.error("Failed to queue Meta webhook", serializeError(e));
    return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
