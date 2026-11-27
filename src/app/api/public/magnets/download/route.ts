import { NextRequest, NextResponse } from "next/server";
import { escapeHtml } from "@/lib/email";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { downloadFromLink } from "@/lib/magnets/service";

export const runtime = "nodejs";

function page(status: number, message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Download</title></head>
<body style="margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<main style="max-width:420px;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.06);text-align:center"><p style="margin:0">${escapeHtml(message)}</p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
}

// GET /api/public/magnets/download?m=&s=&e=&sig=: the signed link from the
// lead-magnet email. Checks it, counts the download and serves the PDF.
export async function GET(req: NextRequest) {
  const rl = await rateLimit(`magnet-dl:${getClientIp(req)}`, 30, 10 * 60 * 1000);
  if (!rl.success) return page(429, "Too many downloads. Try again in a few minutes.");
  const q = req.nextUrl.searchParams;
  const r = await downloadFromLink({ m: q.get("m"), s: q.get("s"), e: q.get("e"), sig: q.get("sig") });
  if (!r.ok) return page(r.status, r.message);
  if ("redirect" in r.file) return NextResponse.redirect(r.file.redirect, { headers: { "Cache-Control": "no-store" } });
  const name = (r.magnet.fileName ?? "download.pdf").replace(/"/g, "");
  return new NextResponse(new Uint8Array(r.file.body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(r.file.body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
