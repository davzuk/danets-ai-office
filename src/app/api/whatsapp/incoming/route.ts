import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  let phoneNumber = "";
  let messageText = "";

  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    phoneNumber = msg.from || ""; messageText = msg.text?.body || "";
  } else if (body?.From) {
    phoneNumber = body.From.replace("whatsapp:", "").replace("+", ""); messageText = body.Body || "";
  } else if (body?.from) {
    phoneNumber = body.from; messageText = body.text || body.message || "";
  }

  if (!phoneNumber || !messageText) return NextResponse.json({ error: "Could not parse message" }, { status: 400 });

  const integration = await db.whatsAppIntegration.findFirst({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
  if (!integration) return NextResponse.json({ error: "No active integration" }, { status: 404 });

  await db.whatsAppMessage.create({ data: { businessId: integration.businessId, direction: "inbound", status: "read", phoneNumber, message: messageText } });
  return NextResponse.json({ status: "success" });
}
