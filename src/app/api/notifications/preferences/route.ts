import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const NOTIF_TYPES = [
  { type: "new_lead", label: "New Lead Captured", default: true },
  { type: "new_ticket", label: "New Support Ticket", default: true },
  { type: "urgent_ticket", label: "Urgent Ticket", default: true },
  { type: "proposal_generated", label: "Proposal Generated", default: false },
  { type: "proposal_accepted", label: "Proposal Accepted", default: true },
  { type: "follow_up_reminder", label: "Follow-up Reminder", default: true },
  { type: "high_quality_lead", label: "High Quality Lead", default: true },
  { type: "ai_usage_warning", label: "AI Usage Warning", default: true },
  { type: "subscription_expiry", label: "Subscription Expiry", default: true },
  { type: "integration_failed", label: "Integration Failed", default: true },
  { type: "content_insight", label: "Weekly Content Insight", default: true },
  { type: "booking_created", label: "New or Moved Booking", default: true },
  { type: "booking_cancelled", label: "Booking Cancelled", default: true },
  { type: "form_submitted", label: "Form Submission", default: true },
];

// GET /api/notifications/preferences — get user's notification preferences
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const existing = await db.notificationPreference.findMany({
      where: { businessId: user.businessId, userId: user.userId },
    });
    const map = new Map(existing.map((p) => [p.type, p]));

    return {
      preferences: NOTIF_TYPES.map((t) => {
        const pref = map.get(t.type);
        return {
          type: t.type,
          label: t.label,
          inApp: pref ? pref.inApp : t.default,
          email: pref ? pref.email : false,
        };
      }),
    };
  });
}

// PUT /api/notifications/preferences — update preferences
export function PUT(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => ({}));
    // body: { preferences: [{ type, inApp, email }] }
    const prefs = body?.preferences;
    if (!Array.isArray(prefs)) throw new Error("Invalid input");

    for (const p of prefs) {
      if (!p.type || typeof p.inApp !== "boolean" || typeof p.email !== "boolean") {
        continue;
      }
      await db.notificationPreference.upsert({
        where: {
          businessId_userId_type: {
            businessId: user.businessId,
            userId: user.userId,
            type: p.type,
          },
        },
        create: {
          businessId: user.businessId,
          userId: user.userId,
          type: p.type,
          inApp: p.inApp,
          email: p.email,
        },
        update: {
          inApp: p.inApp,
          email: p.email,
        },
      });
    }

    return { success: true };
  });
}
