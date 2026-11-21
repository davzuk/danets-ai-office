import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { brandProfileInputSchema } from "@/lib/brand-schema";
import { getBrandProfileRow, saveBrandProfile, toView } from "@/lib/brand";

// GET /api/brand-profile: the tenant's Brand Voice (any member can read it).
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const [row, kbCount] = await Promise.all([
      getBrandProfileRow(user.businessId),
      db.knowledgeBaseItem.count({ where: { businessId: user.businessId, status: "active" } }),
    ]);
    return { brand: toView(row), canEdit: user.role === "admin", kbCount };
  });
}

// PUT /api/brand-profile: replace the profile (admins only).
export function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const body = await req.json().catch(() => null);
    const parsed = brandProfileInputSchema.safeParse(body?.profile);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(`Invalid brand profile: ${issue?.path.join(".") || "body"} ${issue?.message ?? ""}`.trim(), {
        status: 400,
        code: "INVALID_BRAND_PROFILE",
      });
    }
    const row = await saveBrandProfile(user.businessId, parsed.data);
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "brand_profile_updated",
      module: "settings",
      description: "Brand voice updated",
    });
    return { brand: toView(row) };
  });
}
