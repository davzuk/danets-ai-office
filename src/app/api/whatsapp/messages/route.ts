import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const { searchParams } = new URL(req.url);
  const direction = searchParams.get("direction") || undefined;
  const leadId = searchParams.get("leadId") || undefined;

  const where: any = { businessId: user.businessId };
  if (direction) where.direction = direction;
  if (leadId) where.leadId = leadId;

  const messages = await db.whatsAppMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ messages: messages.map((m) => ({ id: m.id, direction: m.direction, status: m.status, phoneNumber: m.phoneNumber, message: m.message, leadId: m.leadId, sentByName: m.sentByName, providerRef: m.providerRef, errorMessage: m.errorMessage, createdAt: m.createdAt.toISOString(), sentAt: m.sentAt?.toISOString() || null })) });
}
