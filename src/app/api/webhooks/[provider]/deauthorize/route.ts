import { NextRequest, NextResponse } from "next/server";
import { logger, serializeError } from "@/lib/logger";
import { handleMetaDeauthorize } from "@/lib/social/meta-deauth";
import { parseMetaSignedRequest } from "@/lib/social/meta-signed-request";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ provider: string }> };

/**
 * POST /api/webhooks/meta/deauthorize — Meta's "Deauthorize callback URL".
 * Called when a user removes the app; the body is form-encoded `signed_request`.
 */
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { provider } = await params;
  if (provider !== "meta") return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const body = await req.formData().catch(() => null);
  const signed = parseMetaSignedRequest(body?.get("signed_request")?.toString(), process.env.META_APP_SECRET);
  if (!signed) return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });

  try {
    const affected = await handleMetaDeauthorize(signed.user_id);
    logger.info("Meta deauthorize processed", { connections: affected });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error("Meta deauthorize failed", serializeError(e));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
