import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyMetaSignature, verifyTwilioSignature } from "@/lib/webhook-signatures";

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
  // Read raw body once — both Meta (JSON) and Twilio (form-encoded) HMACs
  // must be computed against the unmodified request bytes.
  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") || "";

  let body: Record<string, unknown> | null = null;
  let formFields: URLSearchParams | null = null;

  if (contentType.includes("application/json")) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    formFields = new URLSearchParams(rawBody);
    body = Object.fromEntries(formFields.entries());
  } else {
    return NextResponse.json(
      { error: "Unsupported content type" },
      { status: 415 }
    );
  }

  if (!body) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // Resolve the integration up-front so we know which app secret to use
  // for signature verification. The lookup itself does not depend on the
  // body, but we need it to pick the right provider credentials.
  const { searchParams } = new URL(req.url);
  const integration = await resolveIntegration(body, searchParams);
  if (!integration) {
    return NextResponse.json(
      { error: "No matching WhatsApp integration" },
      { status: 404 }
    );
  }

  // Verify the signature for the resolved provider. Reject anything that
  // doesn't match — this is the only thing standing between the internet
  // and our AI agent / automation triggers.
  if (integration.provider === "meta_cloud_api") {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      console.error(
        "[whatsapp/incoming] META_APP_SECRET not configured; rejecting webhook"
      );
      return NextResponse.json(
        { error: "Webhook signing not configured" },
        { status: 503 }
      );
    }
    const ok = verifyMetaSignature(
      rawBody,
      req.headers.get("x-hub-signature-256"),
      secret
    );
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }
  } else if (integration.provider === "twilio") {
    const secret = process.env.TWILIO_AUTH_TOKEN;
    if (!secret || !formFields) {
      return NextResponse.json(
        { error: "Webhook signing not configured" },
        { status: 503 }
      );
    }
    const ok = verifyTwilioSignature(
      req.url,
      formFields,
      req.headers.get("x-twilio-signature"),
      secret
    );
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  let phoneNumber = "";
  let messageText = "";
  let providerRef: string | null = null;

  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = (body as any).entry[0].changes[0].value.messages[0];
    phoneNumber = msg.from || "";
    messageText = msg.text?.body || "";
    providerRef = msg.id ?? null;
  } else if (body?.From) {
    phoneNumber = String(body.From).replace("whatsapp:", "").replace("+", "");
    messageText = String(body.Body || "");
    providerRef = String(body.MessageSid ?? body.SmsSid ?? "") || null;
  } else if (body?.from) {
    phoneNumber = String(body.from);
    messageText = String(body.text || body.message || "");
  }

  if (!phoneNumber || !messageText) {
    return NextResponse.json({ error: "Could not parse message" }, { status: 400 });
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

  // Idempotent insert: if Meta retries this delivery, the second call sees
  // a row with this providerRef + businessId and short-circuits with 200.
  // We can't use a unique constraint (providerRef is nullable), so do a
  // conditional create.
  if (providerRef) {
    const existing = await db.whatsAppMessage.findFirst({
      where: {
        businessId: integration.businessId,
        providerRef,
        direction: "inbound",
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ status: "duplicate" });
    }
  }

  await db.whatsAppMessage.create({
    data: {
      businessId: integration.businessId,
      direction: "inbound",
      status: "read",
      phoneNumber,
      message: messageText,
      providerRef,
    },
  });

  return NextResponse.json({ status: "success" });
}
