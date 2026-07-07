import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function resolveIntegration(
  body: Record<string, unknown>,
  searchParams: URLSearchParams
) {
  const integrationId = searchParams.get("integrationId");
  if (integrationId) {
    return db.whatsAppIntegration.findFirst({
      where: { id: integrationId, status: "active" },
    });
  }

  const metaPhoneNumberId =
    (body as any)?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (metaPhoneNumberId) {
    return db.whatsAppIntegration.findFirst({
      where: { phoneNumberId: String(metaPhoneNumberId), status: "active" },
    });
  }

  const twilioTo = (body as any)?.To?.replace?.("whatsapp:", "")?.replace?.("+", "");
  if (twilioTo) {
    return db.whatsAppIntegration.findFirst({
      where: {
        status: "active",
        OR: [
          { phoneNumber: twilioTo },
          { phoneNumber: `+${twilioTo}` },
        ],
      },
    });
  }

  return null;
}

// Meta Cloud API webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    mode === "subscribe" &&
    challenge &&
    verifyToken &&
    token === verifyToken
  ) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  let phoneNumber = "";
  let messageText = "";

  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    phoneNumber = msg.from || "";
    messageText = msg.text?.body || "";
  } else if (body?.From) {
    phoneNumber = body.From.replace("whatsapp:", "").replace("+", "");
    messageText = body.Body || "";
  } else if (body?.from) {
    phoneNumber = body.from;
    messageText = body.text || body.message || "";
  }

  if (!phoneNumber || !messageText) {
    return NextResponse.json({ error: "Could not parse message" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const integration = await resolveIntegration(body, searchParams);
  if (!integration) {
    return NextResponse.json(
      { error: "No matching WhatsApp integration" },
      { status: 404 }
    );
  }

  // Ignore inbound messages for suspended businesses.
  const business = await db.business.findUnique({
    where: { id: integration.businessId },
    select: { status: true },
  });
  if (!business || business.status !== "active") {
    return NextResponse.json(
      { error: "Business unavailable" },
      { status: 403 }
    );
  }

  await db.whatsAppMessage.create({
    data: {
      businessId: integration.businessId,
      direction: "inbound",
      status: "read",
      phoneNumber,
      message: messageText,
    },
  });

  return NextResponse.json({ status: "success" });
}
