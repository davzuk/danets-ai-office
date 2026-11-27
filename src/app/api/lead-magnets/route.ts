import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { createMagnet, listMagnets, toMagnetDto } from "@/lib/magnets/service";

const canEdit = (role: string) => role === "admin" || role === "owner";

// /api/lead-magnets: the tenant's lead magnets (Phase 2, workstream T).
export async function GET() {
  return withSession(async (user) => ({ magnets: await listMagnets(user.businessId) }));
}

// POST /api/lead-magnets: { title, kind: "upload" | "ai", description?, bullets?, formId?, content?, style? }
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (!canEdit(user.role)) throw new Error("FORBIDDEN");
    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const m = await createMagnet(user.businessId, body);
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "lead_magnet_created", module: "leads", description: `Created the lead magnet "${m.title}"`, metadata: { leadMagnetId: m.id } });
    return { magnet: toMagnetDto(m) };
  });
}
