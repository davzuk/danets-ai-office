import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const patchSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  plan: z.enum(["free", "starter", "pro", "enterprise"]).optional(),
  name: z.string().min(2).max(120).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/super-admin/businesses/[id] — detailed business view
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const business = await db.business.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, email: true, role: true, isSuperAdmin: true, createdAt: true } },
      subscription: true,
      _count: {
        select: {
          leads: true,
          chatSessions: true,
          supportTickets: true,
          quoteRequests: true,
          knowledgeBaseItems: true,
          documents: true,
          usageLogs: true,
        },
      },
    },
  });

  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ business });
}

// PATCH /api/super-admin/businesses/[id] — update business status/plan
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const business = await db.business.findUnique({ where: { id } });
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: any = {};
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.plan) data.plan = parsed.data.plan;
  if (parsed.data.name) data.name = parsed.data.name.trim();

  const updated = await db.business.update({ where: { id }, data });

  // Log to the business's audit log
  await logActivity({
    businessId: id,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "business_settings_changed",
    module: "business",
    description: `Super admin updated business: ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  });

  return NextResponse.json({ business: updated });
}
