import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isAppError } from "@/lib/app-error";
import { clearWlDomain } from "@/lib/white-label/domains";

// DELETE /api/white-label/domain: disconnect the white-label custom domain.
export async function DELETE() {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    await clearWlDomain(user.businessId);
    return NextResponse.json({ domain: null });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json(e.toResponseBody(), { status: e.status });
    throw e;
  }
}