import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { checkBusiness, publicLocation, publicProperty } from "@/lib/seo/setup";

type Ctx = { params: Promise<{ id: string }> };

async function view(businessId: string) {
  const [properties, locations] = await Promise.all([
    db.searchProperty.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.businessLocation.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { properties: properties.map(publicProperty), locations: locations.map(publicLocation) };
}

// GET /api/super-admin/businesses/<id>/seo: the tenant's Search Console
// properties and Business Profile locations, with their last check.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  if (!(await db.business.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  return NextResponse.json(await view(id));
}

// POST {action: "check"} re-checks access now; {action: "remove", kind, itemId}
// clears a property or location (e.g. one that belongs to someone else).
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; kind?: unknown; itemId?: unknown } | null;
  if (body?.action === "check") {
    await checkBusiness(id);
    return NextResponse.json(await view(id));
  }
  if (body?.action === "remove" && (body.kind === "property" || body.kind === "location") && typeof body.itemId === "string") {
    const label =
      body.kind === "property"
        ? (await db.searchProperty.findFirst({ where: { id: body.itemId, businessId: id } }))?.siteUrl
        : (await db.businessLocation.findFirst({ where: { id: body.itemId, businessId: id } }))?.title;
    if (!label) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (body.kind === "property") await db.searchProperty.delete({ where: { id: body.itemId } });
    else await db.businessLocation.delete({ where: { id: body.itemId } });
    await logActivity({
      businessId: id,
      userName: `${auth.user.name} (Super Admin)`,
      action: "delete",
      module: "seo",
      description: `Platform removed the ${body.kind === "property" ? "Search Console property" : "Business Profile location"} ${label}`,
    });
    return NextResponse.json(await view(id));
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
