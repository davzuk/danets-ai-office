import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { requireQuota } from "@/lib/plan-quota";

// GET /api/team — list team members for the business
export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const members = await db.businessUser.findMany({
      where: { businessId: user.businessId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return { members, currentUserId: user.userId };
  });
}

const inviteSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
  password: z.string().min(6).max(100),
});

// POST /api/team — add a new team member
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    // Only admins can invite
    if (user.role !== "admin") {
      throw new Error("FORBIDDEN");
    }

    const body = await req.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const { name, email, role, password } = parsed.data;

    // Check email not already taken
    const existing = await db.businessUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      throw new Error("Email already registered");
    }

    await requireQuota(user.businessId, "seats");

    const member = await db.businessUser.create({
      data: {
        businessId: user.businessId,
        name: name.trim(),
        email: email.toLowerCase(),
        password: await bcrypt.hash(password, 10),
        role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return { member };
  });
}
