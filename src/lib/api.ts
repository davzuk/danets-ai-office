import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

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
    if (e?.message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "Your monthly AI request quota has been reached. Please upgrade your plan to continue." },
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
