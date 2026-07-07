import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

const sendSchema = z.object({
  phoneNumber: z.string().min(5).max(20),
  message: z.string().min(1).max(2000),
  leadId: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const body = await req.json().catch(() => null);
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const result = await sendWhatsAppMessage(user.businessId, parsed.data.phoneNumber, parsed.data.message, {
    leadId: parsed.data.leadId || undefined, templateId: parsed.data.templateId || undefined,
    sentBy: user.userId, sentByName: user.name,
  });

  await logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "integration_changed", module: "integrations", description: `WhatsApp message sent to ${parsed.data.phoneNumber}: ${result.success ? "success" : "failed"}` });

  return NextResponse.json({
    success: result.success, clickToChatUrl: result.clickToChatUrl, providerRef: result.providerRef, error: result.error,
    note: result.clickToChatUrl ? "Manual mode — click the link to open WhatsApp." : result.success ? "Message sent." : "Failed.",
  });
}
