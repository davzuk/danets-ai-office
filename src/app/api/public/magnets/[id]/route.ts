import { NextRequest, NextResponse } from "next/server";
import { blockedOriginFor, publicPreflight, withPublicCors } from "@/lib/public-cors";
import { loadPublicMagnet } from "@/lib/magnets/service";

export const OPTIONS = publicPreflight;

type Ctx = { params: Promise<{ id: string }> };

// GET /api/public/magnets/<id>: a published lead magnet and its gate form,
// as the embed and hosted page render them. The file itself is never here.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withPublicCors(async (inner: NextRequest) => {
    const loaded = await loadPublicMagnet(id);
    if (!loaded) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const blocked = await blockedOriginFor(inner, loaded.loaded.business);
    if (blocked) return blocked;
    return NextResponse.json({ magnet: loaded.public }, { headers: { "Cache-Control": "public, max-age=60" } });
  })(req);
}
