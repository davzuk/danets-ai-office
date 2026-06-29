import { NextRequest } from "next/server";

// A mock payment checkout page that simulates the Paystack/Flutterwave checkout flow.
// In production, users would be redirected to the actual provider's hosted checkout.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const ref = params.get("ref") || "";
  const amount = params.get("amount") || "0";
  const currency = params.get("currency") || "USD";
  const email = params.get("email") || "";
  const provider = params.get("provider") || "paystack";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Payment Checkout — ${provider}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;color:#1a1a2e;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
  .card{background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.15);max-width:440px;width:100%;overflow:hidden;}
  .header{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;padding:28px 24px;text-align:center;}
  .header h1{font-size:18px;font-weight:600;margin-bottom:4px;}
  .header p{font-size:12px;opacity:.85;}
  .body{padding:28px 24px;}
  .detail{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f0f0f0;}
  .detail:last-child{border-bottom:none;}
  .detail-label{color:#6b7280;font-size:13px;}
  .detail-value{font-weight:600;font-size:14px;}
  .amount{font-size:36px;font-weight:800;text-align:center;margin:20px 0;color:#1d4ed8;}
  .amount small{font-size:14px;font-weight:500;color:#6b7280;}
  .btn{display:block;width:100%;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px;transition:transform .2s;}
  .btn-primary{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;}
  .btn-primary:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(29,78,216,.3);}
  .btn-secondary{background:#f4f5f7;color:#6b7280;}
  .btn-secondary:hover{background:#e8e9eb;}
  .secure{text-align:center;margin-top:16px;font-size:11px;color:#9ca3af;}
  .secure svg{vertical-align:middle;margin-right:4px;}
  .badge{display:inline-block;background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:11px;margin-top:8px;}
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🔒 Secure Checkout</h1>
      <p>${provider.charAt(0).toUpperCase() + provider.slice(1)} Payment Gateway</p>
      <div class="badge">Test Mode</div>
    </div>
    <div class="body">
      <div class="amount">${currency} ${parseFloat(amount).toFixed(2)}<small> / ${parseFloat(amount) > 0 ? "one-time" : "free"}</small></div>
      <div class="detail"><span class="detail-label">Reference</span><span class="detail-value" style="font-size:11px;font-family:monospace;">${ref}</span></div>
      <div class="detail"><span class="detail-label">Email</span><span class="detail-value" style="font-size:12px;">${email}</span></div>
      <div class="detail"><span class="detail-label">Provider</span><span class="detail-value">${provider}</span></div>
      <div class="detail"><span class="detail-label">Status</span><span class="detail-value" style="color:#f59e0b;">Pending</span></div>

      <button class="btn btn-primary" onclick="confirmPayment()">Pay ${currency} ${parseFloat(amount).toFixed(2)}</button>
      <button class="btn btn-secondary" onclick="cancelPayment()">Cancel</button>

      <div class="secure">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Your payment is secured with 256-bit SSL encryption
      </div>
    </div>
  </div>

  <script>
    async function confirmPayment() {
      const btn = document.querySelector('.btn-primary');
      btn.textContent = 'Processing...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/payments/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reference: '${ref}', status: 'success' })
        });
        const data = await res.json();

        if (res.ok) {
          document.querySelector('.card').innerHTML =
            '<div class="header" style="background:linear-gradient(135deg,#059669,#10b981);">' +
            '<h1>✅ Payment Successful</h1>' +
            '<p>Your subscription has been activated</p></div>' +
            '<div class="body">' +
            '<div class="detail"><span class="detail-label">Amount</span><span class="detail-value">${currency} ${parseFloat(amount).toFixed(2)}</span></div>' +
            '<div class="detail"><span class="detail-label">Reference</span><span class="detail-value" style="font-size:11px;font-family:monospace;">${ref}</span></div>' +
            (data.invoice ? '<div class="detail"><span class="detail-label">Invoice</span><span class="detail-value">' + data.invoice.invoiceNumber + '</span></div>' : '') +
            '<button class="btn btn-primary" onclick="window.location.href=\'/\'">Return to Dashboard</button>' +
            '</div>';
        } else {
          throw new Error(data.error || 'Verification failed');
        }
      } catch(e) {
        btn.textContent = 'Pay ${currency} ${parseFloat(amount).toFixed(2)}';
        btn.disabled = false;
        alert('Payment failed: ' + e.message);
      }
    }

    function cancelPayment() {
      window.location.href = '/';
    }
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
