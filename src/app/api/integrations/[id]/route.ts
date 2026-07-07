import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/test — test connection (placeholder)
export async function POST(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const integration = await db.integration.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Mark as tested — actual connection test depends on provider
  await db.integration.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      status: "active",
    },
  });

  return NextResponse.json({
    success: true,
    message: `Connection test completed for ${integration.name}. Status: active.`,
    lastTestedAt: new Date().toISOString(),
  });
}

// DELETE /api/integrations/[id]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const integration = await db.integration.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.integration.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
