import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * POST /api/log/client — receives client-side log events via sendBeacon
 * and forwards them into the structured server logger. SendBeacon doesn't
 * allow custom response shapes reliably, so we return 204 on success.
 */
const schema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  msg: z.string().max(500),
  fields: z.record(z.unknown()).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  ts: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const text = await req.text().catch(() => "");
  let parsed;
  try {
    parsed = schema.parse(JSON.parse(text));
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const fn = (logger as any)[parsed.level];
  if (typeof fn === "function") {
    fn(parsed.msg, {
      source: "client",
      url: parsed.url,
      userAgent: parsed.userAgent,
      clientTs: parsed.ts,
      ...(parsed.fields ?? {}),
    });
  }
  return new NextResponse(null, { status: 204 });
}