import { NextResponse } from "next/server";
import { readBrand } from "@/lib/white-label/brand";

export const dynamic = "force-dynamic";

// GET /api/brand: the white-label brand for the requesting host, if the host
// is a verified custom domain. Used by the login page and dashboard shell.
export async function GET() {
  return NextResponse.json({ brand: await readBrand() });
}