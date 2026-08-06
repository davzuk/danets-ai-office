import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth";
import { ModuleAccessError } from "@/lib/module-access";
import { MODULE_REGISTRY, formatPlanLabel } from "@/lib/module-registry";
import {
  LimitExceededError,
  formatLimitExceededMessage,
} from "@/lib/plan-quota";
import { logger, serializeError, withRequestContext } from "@/lib/logger";

async function readRequestContextHeaders(): Promise<{ requestId: string | undefined; route: string | undefined }> {
  // next/headers is available inside API route handlers but not inside the
  // bare middleware. The middleware writes the same two values onto the
  // request headers as `x-request-id` and `x-danets-pathname`, so we can
  // pick them up there too when running inside a route.
  try {
    const h = await headers();
    return {
      requestId: h.get("x-request-id") || undefined,
      route: h.get("x-danets-pathname") || undefined,
    };
  } catch {
    return { requestId: undefined, route: undefined };
  }
}

export async function apiHandler<T>(
  fn: () => Promise<T>
): Promise<NextResponse> {
  const { requestId, route } = await readRequestContextHeaders();
  const start = Date.now();
  return withRequestContext({ requestId, route }, async () => {
    try {
      const result = await fn();
      const latencyMs = Date.now() - start;
      logger.info("api.request", { latencyMs });
      return NextResponse.json(result);
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      if (e?.message === "UNAUTHORIZED") {
        logger.info("api.unauthorized", { latencyMs });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (e?.message === "FORBIDDEN") {
        logger.info("api.forbidden", { latencyMs });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (e?.message === "SUSPENDED") {
        logger.info("api.suspended", { latencyMs });
        return NextResponse.json(
          { error: "Your account is suspended. Please contact support." },
          { status: 403 }
        );
      }
      if (e?.message === "SUBSCRIPTION_INACTIVE") {
        logger.info("api.subscription_inactive", { latencyMs });
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
        logger.info("api.subscription_read_only", { latencyMs });
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
        logger.info("api.quota_exceeded", { latencyMs });
        return NextResponse.json(
          { error: "Your monthly AI request quota has been reached. Please upgrade your plan to continue." },
          { status: 429 }
        );
      }
      if (e?.message === "CSRF_INVALID") {
        logger.warn("api.csrf_invalid", { latencyMs });
        return NextResponse.json(
          { error: "Invalid or missing CSRF token. Please reload the page and try again." },
          { status: 403 }
        );
      }
      if (e instanceof ModuleAccessError) {
        logger.info("api.module_access_denied", { latencyMs, module: e.module, requiredPlan: e.requiredPlan });
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
        logger.info("api.limit_exceeded", { latencyMs, resource: e.resource, limit: e.limit });
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
      logger.error("api.error", { latencyMs, ...serializeError(e) });
      return NextResponse.json(
        { error: e?.message || "Internal server error" },
        { status: 500 }
      );
    }
  });
}

export async function withSession<T>(
  fn: (user: Awaited<ReturnType<typeof requireSession>>) => Promise<T>
): Promise<NextResponse> {
  return apiHandler(async () => {
    const user = await requireSession();
    // Augment the AsyncLocalStorage context with the user we just resolved
    // so subsequent logger calls in deeper helpers carry userId/businessId.
    const { setRequestContextField } = await import("@/lib/logger");
    setRequestContextField("userId", user.userId);
    setRequestContextField("businessId", user.businessId);
    return fn(user);
  });
}
