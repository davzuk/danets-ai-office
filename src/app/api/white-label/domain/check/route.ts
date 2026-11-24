import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isAppError } from "@/lib/app-error";
import { checkWlDomainNow, wlDomainView } from "@/lib/white-label/domains";

// POST /api/white-label/domain/check: look up the DNS TXT record now instead of waiting for the job.
export async function POST() {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    const config = await checkWlDomainNow(user.businessId);
    return NextResponse.json({ domain: wlDomainView(config) });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json(e.toResponseBody(), { status: e.status });
    throw e;
  }
}