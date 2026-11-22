import { NextRequest } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { mayIssueCertificate } from "@/lib/sites/domains";

export const dynamic = "force-dynamic";

// GET /api/public/domains/check?domain=<host>: the TLS proxy's "ask" hook
// (Caddy on_demand_tls). 200 lets it get a certificate for that host; any
// other status refuses. Only verified, servable tenant hosts pass.
export async function GET(req: NextRequest) {
  // Generous: the proxy asks once per new host, but from one address.
  const rl = await rateLimit(`domask:${getClientIp(req)}`, 600, 10 * 60 * 1000);
  if (!rl.success) return new Response("slow down", { status: 429 });
  const domain = req.nextUrl.searchParams.get("domain") ?? "";
  const ok = domain.length > 0 && domain.length <= 253 && (await mayIssueCertificate(domain));
  return new Response(ok ? "ok" : "no", { status: ok ? 200 : 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
