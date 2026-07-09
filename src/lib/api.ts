import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ModuleAccessError } from "@/lib/module-access";
import { MODULE_REGISTRY, formatPlanLabel } from "@/lib/module-registry";
import {
  LimitExceededError,
  formatLimitExceededMessage,
} from "@/lib/plan-quota";

export async function apiHandler<T>(
  fn: () => Promise<T>
): Promise<NextResponse> {
  try {
    const result = await fn();
    return NextResponse.json(result);
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (e?.message === "SUSPENDED") {
      return NextResponse.json(
        { error: "Your account is suspended. Please contact support." },
        { status: 403 }
      );
    }
    if (e?.message === "SUBSCRIPTION_INACTIVE") {
      return NextResponse.json(
        {
          error:
            "Your subscription is inactive. Please renew or reactivate your plan to continue.",
          code: "SUBSCRIPTION_INACTIVE",
        },
        { status: 403 }
      );
    }
    if (e?.message === "SUBSCRIPTION_READ_ONLY") {
      return NextResponse.json(
        {
          error:
            "Your account is in read-only mode due to a past-due payment. Resolve billing to make changes.",
          code: "SUBSCRIPTION_READ_ONLY",
        },
        { status: 403 }
      );
    }
    if (e?.message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "Your monthly AI request quota has been reached. Please upgrade your plan to continue." },
        { status: 429 }
      );
    }
    if (e instanceof ModuleAccessError) {
      const label = MODULE_REGISTRY[e.module]?.label ?? e.module;
      return NextResponse.json(
        {
          error: `${label} requires the ${formatPlanLabel(e.requiredPlan)} plan or higher.`,
          code: "MODULE_REQUIRED",
          module: e.module,
          requiredPlan: e.requiredPlan,
        },
        { status: 403 }
      );
    }
    if (e instanceof LimitExceededError) {
      return NextResponse.json(
        {
          error: formatLimitExceededMessage(e),
          code: "LIMIT_EXCEEDED",
          resource: e.resource,
          limit: e.limit,
          used: e.used,
        },
        { status: 429 }
      );
    }
    console.error("[api error]", e);
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function withSession<T>(
  fn: (user: Awaited<ReturnType<typeof requireSession>>) => Promise<T>
): Promise<NextResponse> {
  return apiHandler(async () => {
    const user = await requireSession();
    return fn(user);
  });
}
