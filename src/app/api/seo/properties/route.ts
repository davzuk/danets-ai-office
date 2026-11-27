import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { addProperty, publicProperty } from "@/lib/seo/setup";

const schema = z.object({ connectionId: z.string().min(1).max(40), siteUrl: z.string().trim().min(1).max(300) });

// POST /api/seo/properties {connectionId, siteUrl}: add a Search Console property.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Choose a property.", { status: 400, code: "INVALID_INPUT" });
    const row = await addProperty({ businessId: user.businessId, userId: user.userId, name: user.name }, parsed.data);
    return { property: publicProperty(row) };
  });
}
