import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const pk = req.nextUrl.searchParams.get("pk");
  if (!pk) {
    return NextResponse.json({ error: "Missing pk" }, { status: 400 });
  }

  const business = await db.business.findUnique({
    where: { publicKey: pk, status: "active" },
    select: { id: true, name: true, publicKey: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
      leadCaptureEnabled: true,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "No active agent" }, { status: 503 });
  }

  // Cache for 5 min at edge
  return NextResponse.json(
    { publicKey: business.publicKey, businessName: business.name, agent },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
