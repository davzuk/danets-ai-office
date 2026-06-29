import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// GET /api/leads/export — download all leads for the business as CSV
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const quality = searchParams.get("quality") || undefined;

  const where: any = { businessId: user.businessId };
  if (status) where.status = status;
  if (quality) where.quality = quality;

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { session: { select: { id: true, visitorEmail: true } } },
  });

  const headers = [
    "ID",
    "Name",
    "Email",
    "Phone",
    "Service",
    "Message",
    "Quality",
    "Status",
    "Source",
    "Created At",
    "Linked Session",
  ];

  const rows = leads.map((l) => [
    l.id,
    l.name,
    l.email || "",
    l.phone || "",
    l.service || "",
    l.message || "",
    l.quality,
    l.status,
    l.source,
    l.createdAt.toISOString(),
    l.sessionId || "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  const BOM = "\uFEFF"; // helps Excel detect UTF-8
  return new NextResponse(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="danets-leads-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
