import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

// GET /api/super-admin/users — list users across all tenants
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const businessId = searchParams.get("businessId") || undefined;
  const role = searchParams.get("role") || undefined;

  const where: Record<string, unknown> = {};
  if (businessId) where.businessId = businessId;
  if (role) where.role = role;
  if (q) {
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }

  const users = await db.businessUser.findMany({
    where: where as Prisma.BusinessUserWhereInput,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isSuperAdmin: true,
      createdAt: true,
      business: { select: { id: true, name: true, status: true, plan: true } },
    },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isSuperAdmin: u.isSuperAdmin,
      createdAt: u.createdAt.toISOString(),
      business: u.business,
    })),
  });
}
