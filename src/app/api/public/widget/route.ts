import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { blockedOrigin, publicPreflight, withPublicCors } from "@/lib/public-cors";

export const OPTIONS = publicPreflight;

export const GET = withPublicCors(async (req: NextRequest) => {
  const pk = req.nextUrl.searchParams.get("pk");
  if (!pk) {
    return NextResponse.json({ error: "Missing pk" }, { status: 400 });
  }

  const business = await db.business.findUnique({
    where: { publicKey: pk, status: "active" },
    select: { id: true, name: true, publicKey: true, widgetAllowedOrigins: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const blocked = blockedOrigin(req, business.widgetAllowedOrigins);
  if (blocked) return blocked;

  const agent = await db.aiAgent.findFirst({
    where: { businessId: business.id, status: "active" },
    select: {
      botName: true,
      businessName: true,
      welcomeMessage: true,
      fallbackMessage: true,
      handoverMessage: true,
      tone: true,
      contactPhone: true,
      whatsappNumber: true,
      email: true,
      brandColor: true,
      quickReplies: true,
      leadCaptureEnabled: true,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "No active agent" }, { status: 503 });
  }

  // Cache for 1 minute in the end-user's browser only.
  //
  // `public` would let any shared proxy / corporate gateway cache the
  // bot config keyed by `pk` — and that key is the customer's identity
  // on the public widget. The audit flagged the previous `public,
  // max-age=300` as leaking customer bot configs to intermediary caches.
  // `private` keeps the response in the browser but tells intermediaries
  // not to store it. We also tag the response so the agent-edit handlers
  // can flush it via `revalidateTag()` on writes.
  return NextResponse.json(
    { publicKey: business.publicKey, businessName: business.name, agent },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    }
  );
});
