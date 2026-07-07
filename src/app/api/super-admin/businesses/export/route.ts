import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

function csvEscape(value: string | number | null | undefined) {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// GET /api/super-admin/businesses/export — CSV export of all tenants
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

  const businesses = await db.business.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          users: true,
          leads: true,
          chatSessions: true,
          supportTickets: true,
        },
      },
      subscription: { select: { status: true, monthlyFee: true } },
    },
  });

  const headers = [
    "id",
    "name",
    "email",
    "industry",
    "plan",
    "status",
    "users",
    "leads",
    "chats",
    "tickets",
    "subscription_status",
    "monthly_fee_usd",
    "created_at",
  ];

  const rows = businesses.map((b) =>
    [
      b.id,
      b.name,
      b.email,
      b.industry,
      b.plan,
      b.status,
      b._count.users,
      b._count.leads,
      b._count.chatSessions,
      b._count.supportTickets,
      b.subscription?.status ?? "",
      b.subscription?.monthlyFee ?? 0,
      b.createdAt.toISOString(),
    ]
      .map(csvEscape)
      .join(",")
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const filename = `danets-tenants-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
