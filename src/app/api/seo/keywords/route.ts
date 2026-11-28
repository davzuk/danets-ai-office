import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { addKeywords, addKeywordsSchema, keywordsData } from "@/lib/seo/keywords";

const actor = (u: { businessId: string; userId: string; name: string; role: string }) => ({ businessId: u.businessId, userId: u.userId, name: u.name, role: u.role });

// GET /api/seo/keywords?propertyId=: tracked keywords with their Search
// Console history, plus top queries not tracked yet.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const propertyId = new URL(req.url).searchParams.get("propertyId");
    return { ...(await keywordsData(user.businessId, { propertyId })), canEdit: user.role === "admin" };
  });
}

// POST {keywords: string | string[], propertyId?, targetUrl?}: track keywords (admin).
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const parsed = addKeywordsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return addKeywords(actor(user), parsed.data);
  });
}
