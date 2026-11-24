import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";

const schema = z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().max(300).optional() });

// PATCH /api/super-admin/sites/<id> {status}: take a tenant's website offline
// or bring it back online.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const site = await db.tenantSite.findUnique({ where: { id: (await params).id } });
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });
  const updated = await db.tenantSite.update({ where: { id: site.id }, data: { status: parsed.data.status } });
  if (site.status !== updated.status) {
    await logActivity({
      businessId: site.businessId,
      userName: `${auth.user.name} (Super Admin)`,
      action: updated.status === "suspended" ? "site_suspended" : "site_restored",
      module: "sites",
      description:
        updated.status === "suspended"
          ? `Website ${site.subdomain} suspended by the platform${parsed.data.reason ? `: ${parsed.data.reason}` : ""}`
          : `Website ${site.subdomain} brought back online by the platform`,
      metadata: { siteId: site.id, reason: parsed.data.reason ?? null },
    });
  }
  return NextResponse.json({ site: { id: updated.id, status: updated.status } });
}