import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { hasCalendarScopes, listWritableCalendars } from "@/lib/booking/google-calendar";
import { ConnectionUnavailableError } from "@/lib/connections/tokens";
import { OAuthGrantError, OAuthProviderError } from "@/lib/connections/types";

// GET /api/booking-sync/google-calendars?connectionId=  Calendars the
// connected Google account can add events to.
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const connectionId = req.nextUrl.searchParams.get("connectionId") ?? "";
    const conn = await db.oAuthConnection.findFirst({
      where: { id: connectionId, businessId: user.businessId, provider: "google" },
      select: { id: true, scopes: true, status: true },
    });
    if (!conn) throw new AppError("Google account not found.", { status: 404, code: "NOT_FOUND" });
    if (!hasCalendarScopes(conn.scopes)) {
      throw new AppError("This Google account hasn't allowed calendar access yet. Connect Google Calendar first.", { status: 409, code: "CALENDAR_SCOPES" });
    }
    try {
      return { calendars: await listWritableCalendars({ connectionId: conn.id, businessId: user.businessId }) };
    } catch (e) {
      if (e instanceof ConnectionUnavailableError || e instanceof OAuthGrantError) {
        throw new AppError("The Google connection has lapsed. Reconnect Google Calendar.", { status: 409, code: "CONNECTION_UNAVAILABLE" });
      }
      if (e instanceof OAuthProviderError) throw new AppError(`Google Calendar didn't respond: ${e.message}`, { status: 502, code: "PROVIDER_ERROR" });
      throw e;
    }
  });
}
