// Shared bits of the public booking API (/api/public/booking*).

import { NextRequest, NextResponse } from "next/server";
import type { BookingType } from "@prisma/client";
import { db } from "@/lib/db";
import { blockedOrigin } from "@/lib/public-cors";
import { isModuleEnabled } from "@/lib/module-access";
import { LOCATION_LABEL, readQuestions } from "./slots";

export interface PublicBusiness {
  id: string;
  name: string;
  timezone: string;
}

/** The business behind a public key, or the response to send instead. */
export async function publicBookingBusiness(req: NextRequest, pk: string | null): Promise<PublicBusiness | NextResponse> {
  if (!pk) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  const business = await db.business.findUnique({
    where: { publicKey: pk },
    select: { id: true, name: true, timezone: true, status: true, plan: true, widgetAllowedOrigins: true },
  });
  if (!business || business.status !== "active") return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const blocked = blockedOrigin(req, business.widgetAllowedOrigins);
  if (blocked) return blocked;
  if (!(await isModuleEnabled(business.id, "leads", business.plan))) {
    return NextResponse.json({ error: "Online booking isn't available for this business." }, { status: 403, headers: { "X-Error-Code": "MODULE_DISABLED" } });
  }
  return { id: business.id, name: business.name, timezone: business.timezone };
}

/** What visitors may see about a booking type (no team member ids, no sync settings). */
export function publicType(t: BookingType) {
  return {
    slug: t.slug,
    name: t.name,
    description: t.description,
    durationMin: t.durationMin,
    location: t.location,
    locationLabel: LOCATION_LABEL[t.location] ?? t.location,
    // Video links and addresses go out in the confirmation, not to every visitor.
    questions: readQuestions(t.questions),
  };
}

export function isValidTimezoneName(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
