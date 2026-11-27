import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { addLocation, publicLocation } from "@/lib/seo/setup";

const schema = z.object({
  connectionId: z.string().min(1).max(40),
  accountName: z.string().regex(/^accounts\/[\w-]{1,100}$/),
  locationName: z.string().regex(/^locations\/[\w-]{1,100}$/),
});

// POST /api/seo/locations {connectionId, accountName, locationName}: manage a
// Business Profile location in Danets.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Choose a location.", { status: 400, code: "INVALID_INPUT" });
    const row = await addLocation({ businessId: user.businessId, userId: user.userId, name: user.name }, parsed.data);
    return { location: publicLocation(row) };
  });
}
