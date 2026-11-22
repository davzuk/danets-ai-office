import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { getConnectionProvider } from "@/lib/connections/registry";
import { hasCalendarScopes } from "@/lib/booking/google-calendar";
import { calendlyStatus } from "@/lib/booking/calendly-connection";

// GET /api/booking-sync: calendar connections for bookings (Pro, the
// "booking_sync" module): Google accounts and whether they can be used for
// calendars, and the Calendly connection.
export async function GET() {
  return withSession(async (user) => {
    const [google, calendly] = await Promise.all([
      db.oAuthConnection.findMany({
        where: { businessId: user.businessId, provider: "google" },
        select: { id: true, accountName: true, accountEmail: true, scopes: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
      calendlyStatus(user.businessId),
    ]);
    return {
      canEdit: user.role === "admin",
      google: {
        configured: !!getConnectionProvider("google")?.isConfigured(process.env),
        accounts: google.map((c) => ({
          id: c.id,
          name: c.accountName ?? c.accountEmail ?? "Google account",
          email: c.accountEmail,
          status: c.status,
          calendarReady: c.status === "active" && hasCalendarScopes(c.scopes),
        })),
      },
      calendly,
    };
  });
}
