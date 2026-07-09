import { db } from "@/lib/db";

export type SubscriptionAccessLevel = "full" | "read_only" | "blocked";

export type SubscriptionAccess = {
  status: string;
  level: SubscriptionAccessLevel;
  message?: string;
};

import {
  isBillingExempt,
  isEnforcedApiPath,
  READ_METHODS,
} from "@/lib/subscription-access-rules";

export async function getSubscriptionAccess(
  businessId: string
): Promise<SubscriptionAccess> {
  const sub = await db.businessSubscription.findUnique({
    where: { businessId },
    select: { status: true, trialEndsAt: true, endDate: true },
  });

  if (!sub) {
    return { status: "active", level: "full" };
  }

  const now = new Date();

  if (sub.status === "trial" && sub.trialEndsAt && sub.trialEndsAt < now) {
    return {
      status: "expired",
      level: "blocked",
      message: "Your trial has ended. Please subscribe to continue.",
    };
  }

  if (sub.endDate && sub.endDate < now && sub.status !== "active") {
    return {
      status: "expired",
      level: "blocked",
      message: "Your subscription has expired. Please renew to continue.",
    };
  }

  if (sub.status === "canceled" || sub.status === "expired") {
    return {
      status: sub.status,
      level: "blocked",
      message:
        sub.status === "canceled"
          ? "Your subscription was canceled. Reactivate to restore access."
          : "Your subscription has expired. Please renew to continue.",
    };
  }

  if (sub.status === "past_due") {
    return {
      status: "past_due",
      level: "read_only",
      message:
        "Payment is past due. You can view data but cannot make changes until billing is resolved.",
    };
  }

  return { status: sub.status, level: "full" };
}

export async function enforceSubscriptionAccess(
  businessId: string,
  options: { method: string; pathname: string }
): Promise<void> {
  const { method, pathname } = options;
  if (!isEnforcedApiPath(pathname)) return;

  const access = await getSubscriptionAccess(businessId);

  if (access.level === "blocked") {
    if (isBillingExempt(pathname)) return;
    throw new Error("SUBSCRIPTION_INACTIVE");
  }

  if (
    access.level === "read_only" &&
    !READ_METHODS.has(method.toUpperCase())
  ) {
    if (isBillingExempt(pathname)) return;
    throw new Error("SUBSCRIPTION_READ_ONLY");
  }
}
