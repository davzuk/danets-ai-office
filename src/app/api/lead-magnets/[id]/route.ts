import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { deleteMagnet, getMagnet, publishProblems, toMagnetDto, updateMagnet } from "@/lib/magnets/service";

type Ctx = { params: Promise<{ id: string }> };
const canEdit = (role: string) => role === "admin" || role === "owner";

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const m = await getMagnet(user.businessId, id);
    return { magnet: toMagnetDto(m), problems: await publishProblems(m) };
  });
}

// PATCH /api/lead-magnets/<id>: any of title, description, bullets, formId, deliveryEmail, content, style, status
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (!canEdit(user.role)) throw new Error("FORBIDDEN");
    const { id } = await params;
    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const before = await getMagnet(user.businessId, id);
    const m = await updateMagnet(user.businessId, id, body);
    if (before.status !== m.status) {
      const published = m.status === "published";
      logActivity({
        businessId: user.businessId,
        userId: user.userId,
        userName: user.name,
        action: published ? "lead_magnet_published" : "lead_magnet_unpublished",
        module: "leads",
        description: `${published ? "Published" : "Unpublished"} the lead magnet "${m.title}"`,
        metadata: { leadMagnetId: m.id },
      });
    }
    return { magnet: toMagnetDto(m), problems: await publishProblems(m) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (!canEdit(user.role)) throw new Error("FORBIDDEN");
    const { id } = await params;
    const m = await deleteMagnet(user.businessId, id);
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "lead_magnet_deleted", module: "leads", description: `Deleted the lead magnet "${m.title}"`, metadata: { leadMagnetId: m.id } });
    return { success: true };
  });
}
