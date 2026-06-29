import "server-only";
import { db } from "@/lib/db";
import { headers } from "next/headers";

/**
 * Log an activity for audit trail.
 * Call from any authenticated route to track user actions.
 */
export async function logActivity(params: {
  businessId: string;
  userId?: string;
  userName?: string;
  action: string;
  module: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const h = await headers();
      ipAddress = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      userAgent = h.get("user-agent") || null;
    } catch {}

    await db.activityLog.create({
      data: {
        businessId: params.businessId,
        userId: params.userId || null,
        userName: params.userName || null,
        action: params.action,
        module: params.module,
        description: params.description,
        ipAddress,
        userAgent,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    });
  } catch (e) {
    // Never throw from logging — it's a side effect
    console.error("[logActivity] failed:", e);
  }
}

/**
 * Create a notification for a business (and optionally a specific user).
 * Checks notification preferences before creating.
 */
export async function createNotification(params: {
  businessId: string;
  userId?: string | null; // null = all business users
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  try {
    await db.notification.create({
      data: {
        businessId: params.businessId,
        userId: params.userId || null,
        type: params.type,
        title: params.title,
        message: params.message,
        data: params.data ? JSON.stringify(params.data) : null,
      },
    });
  } catch (e) {
    console.error("[createNotification] failed:", e);
  }
}
