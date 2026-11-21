/**
 * Typed error hierarchy for API handlers.
 *
 * Replaces the old `e?.message === "UNAUTHORIZED"` discriminator in
 * `apiHandler`. The error classes carry the fields the handler needs
 * (HTTP status, error code, structured details) so the handler can
 * respond without re-parsing the message string.
 *
 * The constructor signature is intentionally minimal: the most common
 * shape is `throw new QuotaExceededError(...)` and the handler
 * instantiates the right status / code from the class.
 */

export class AppError extends Error {
  /** HTTP status code the handler should respond with. */
  readonly status: number;
  /** Stable machine-readable code clients can switch on. */
  readonly code: string;
  /** Extra details included in the JSON response body. */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts: { status: number; code: string; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    // Restore the prototype chain — extending Error in TS targets ES5
    // by default and `instanceof` would otherwise fail across module
    // boundaries.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serialise to the shape apiHandler sends over the wire. */
  toResponseBody(): { error: string; code: string; [k: string]: unknown } {
    return { error: this.message, code: this.code, ...(this.details ?? {}) };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, { status: 401, code: "UNAUTHORIZED" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { status: 403, code: "FORBIDDEN" });
  }
}

export class SuspendedError extends AppError {
  constructor() {
    super("Your account is suspended. Please contact support.", {
      status: 403,
      code: "SUSPENDED",
    });
  }
}

export class SubscriptionInactiveError extends AppError {
  constructor() {
    super(
      "Your subscription is inactive. Please renew or reactivate your plan to continue.",
      { status: 403, code: "SUBSCRIPTION_INACTIVE" }
    );
  }
}

export class SubscriptionReadOnlyError extends AppError {
  constructor() {
    super(
      "Your account is in read-only mode due to a past-due payment. Resolve billing to make changes.",
      { status: 403, code: "SUBSCRIPTION_READ_ONLY" }
    );
  }
}

export class QuotaExceededError extends AppError {
  constructor(
    message: string,
    public readonly resource: string,
    public readonly limit: number,
    public readonly used: number
  ) {
    super(message, {
      status: 429,
      code: "QUOTA_EXCEEDED",
      details: { resource, limit, used },
    });
  }
}

export class AiQuotaExceededError extends AppError {
  constructor(message: string) {
    super(message, { status: 429, code: "QUOTA_EXCEEDED" });
  }
}

export class CsrfError extends AppError {
  constructor() {
    super("Invalid or missing CSRF token. Please reload the page and try again.", {
      status: 403,
      code: "CSRF_INVALID",
    });
  }
}

export class MaintenanceError extends AppError {
  constructor(message = "Platform is in maintenance mode") {
    super(message, { status: 503, code: "MAINTENANCE" });
  }
}

export class ReauthRequiredError extends AppError {
  constructor(message = "Fresh credentials required for this action.") {
    super(message, {
      status: 401,
      code: "REAUTH_REQUIRED",
    });
  }
}

/**
 * Convenience: recognise any AppError instance regardless of the
 * runtime class identity check (some bundlers emit code that breaks
 * `instanceof` across module graphs).
 */
export function isAppError(e: unknown): e is AppError {
  return (
    !!e &&
    typeof e === "object" &&
    "status" in (e as object) &&
    "code" in (e as object) &&
    typeof (e as { status?: unknown }).status === "number"
  );
}