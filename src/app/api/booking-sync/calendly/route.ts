import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { CalendlyError } from "@/lib/booking/calendly";
import { connectCalendly, disconnectCalendly, listCalendlyEventTypes } from "@/lib/booking/calendly-connection";

// /api/booking-sync/calendly  Connect Calendly with a personal access token
// (PUT), disconnect (DELETE), or list its event types (GET).

export async function GET() {
  return withSession(async (user) => {
    try {
      return { eventTypes: await listCalendlyEventTypes(user.businessId) };
    } catch (e) {
      if (e instanceof CalendlyError) throw new AppError(e.message, { status: 502, code: "PROVIDER_ERROR" });
      throw e;
    }
  });
}

const schema = z.object({ token: z.string().trim().min(20).max(2000) });

export async function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Paste a Calendly personal access token.", { status: 400, code: "INVALID_INPUT" });
    try {
      const status = await connectCalendly(user.businessId, parsed.data.token);
      await logActivity({
        businessId: user.businessId,
        userId: user.userId,
        userName: user.name,
        action: "connection_added",
        module: "leads",
        description: `Connected Calendly${status.email ? ` (${status.email})` : ""}`,
      });
      return { calendly: status };
    } catch (e) {
      if (e instanceof CalendlyError) {
        throw new AppError(e.status === 401 ? "Calendly didn't accept that token. Create a new personal access token and try again." : e.message, {
          status: 400,
          code: "CALENDLY_REJECTED",
        });
      }
      throw e;
    }
  });
}

export async function DELETE() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    await disconnectCalendly(user.businessId);
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "connection_removed",
      module: "leads",
      description: "Disconnected Calendly",
    });
    return { ok: true };
  });
}
