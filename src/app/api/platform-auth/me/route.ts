import { NextResponse } from "next/server";
import { getPlatformSession } from "@/lib/platform-auth";

export async function GET() {
  const admin = await getPlatformSession();
  if (!admin) return NextResponse.json({ admin: null });
  return NextResponse.json({ admin, isPlatformAdmin: true });
}
