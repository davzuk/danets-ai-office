import { NextRequest } from "next/server";

// A simple full HTML page that loads the widget for testing in isolation.
export async function GET(req: NextRequest) {
  const pk = req.nextUrl.searchParams.get("pk") || "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Danets Widget Demo</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;}
  .wrap{max-width:760px;margin:0 auto;padding:40px 20px;}
  .hero{background:linear-gradient(135deg,#1d4ed8,#2563eb 50%,#84cc16);color:#fff;border-radius:20px;padding:40px;margin-bottom:28px;}
  .hero h1{margin:0 0 8px;font-size:28px;}
  .hero p{margin:0;opacity:.9;line-height:1.6;}
  .card{background:#fff;border-radius:16px;padding:24px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
  .card h2{margin:0 0 10px;font-size:18px;}
  .card p{margin:0;color:#555;line-height:1.6;}
  .note{text-align:center;color:#888;font-size:13px;margin-top:24px;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>Acme Demo Site</h1>
      <p>This is a sample website showing how the Danets AI chatbot widget appears to your visitors. Click the chat bubble in the bottom-right corner to start a conversation.</p>
    </div>
    <div class="card">
      <h2>About us</h2>
      <p>We build great products for our customers. Use the chat in the corner to ask anything — our AI assistant is ready to help.</p>
    </div>
    <div class="card">
      <h2>Our services</h2>
      <p>Software, cloud, AI automation and cybersecurity solutions tailored for your business.</p>
    </div>
    <div class="note">Public key: ${pk} — this page is for testing only.</div>
  </div>
  <script src="/widget.js?pk=${pk}" async></script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
