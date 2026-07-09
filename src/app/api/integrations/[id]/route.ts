import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { testIntegrationConnection } from "@/lib/integration-test";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/test — verify provider connectivity
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

  const result = await testIntegrationConnection(integration);

  await db.integration.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      status: result.success ? "active" : "error",
      notes: result.success
        ? result.message
        : [result.message, result.details].filter(Boolean).join(" — "),
    },
  });

  return NextResponse.json({
    success: result.success,
    message: result.message,
    details: result.details,
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
