import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const updateSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  name: z.string().min(2).max(80).optional(),
});

// PATCH /api/team/[id] — update a team member's role or name
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Verify member belongs to same business
  const member = await db.businessUser.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  // Prevent self-demotion (admin locking themselves out)
  if (id === user.userId && parsed.data.role && parsed.data.role !== "admin") {
    return NextResponse.json(
      { error: "You cannot demote yourself" },
      { status: 400 }
    );
  }

  const data: any = {};
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.name) data.name = parsed.data.name.trim();

  const updated = await db.businessUser.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json({ member: updated });
}

// DELETE /api/team/[id] — remove a team member
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Prevent self-deletion
  if (id === user.userId) {
    return NextResponse.json(
      { error: "You cannot remove yourself" },
      { status: 400 }
    );
  }

  // Verify member belongs to same business
  const member = await db.businessUser.findFirst({
    where: { id, businessId: user.businessId },
  });
  if (!member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete their sessions first, then the user
  await db.session.deleteMany({ where: { businessUserId: id } }).catch(() => {});
  await db.businessUser.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
