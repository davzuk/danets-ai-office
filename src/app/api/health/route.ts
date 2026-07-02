import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/health — health check endpoint for monitoring/uptime checks
export async function GET() {
  const startTime = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime ? `${Math.floor(process.uptime())}s` : "unknown",
      database: "connected",
      responseTime: `${Date.now() - startTime}ms`,
      version: "1.0.0",
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: e instanceof Error ? e.message : "Unknown error",
        responseTime: `${Date.now() - startTime}ms`,
      },
      { status: 503 }
    );
  }
}
