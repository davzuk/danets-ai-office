import { NextRequest, NextResponse } from "next/server";
import { logger, serializeError } from "@/lib/logger";
import { handleMetaDataDeletion } from "@/lib/social/meta-deauth";
import { parseMetaSignedRequest } from "@/lib/social/meta-signed-request";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ provider: string }> };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * POST /api/webhooks/meta/data-deletion — Meta's "Data Deletion Request URL".
 * Deletes the user's connections and replies with a status URL and
 * confirmation code, as Meta requires.
 */
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { provider } = await params;
  if (provider !== "meta") return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const body = await req.formData().catch(() => null);
  const signed = parseMetaSignedRequest(body?.get("signed_request")?.toString(), process.env.META_APP_SECRET);
  if (!signed) return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });

  try {
    const { code, deleted } = await handleMetaDataDeletion(signed.user_id);
    logger.info("Meta data deletion processed", deleted);
    return NextResponse.json({ url: `${appUrl()}/data-deletion/${code}`, confirmation_code: code });
  } catch (e) {
    logger.error("Meta data deletion failed", serializeError(e));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
