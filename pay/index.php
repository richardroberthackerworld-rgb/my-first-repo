<?php /* 7Pay — landing + integration docs (light theme). */ ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>7Pay — Payments for the 7By ecosystem</title>
<link rel="icon" type="image/png" href="favicon.png">
<meta name="description" content="7Pay is 7By's own payment gateway: hosted checkout, drop-in JS SDK, webhooks and a merchant dashboard.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/pay.css">
<style>
  .nav { height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 32px; position: sticky; top: 0; z-index: 10; }
  .brand { font-weight: 800; font-size: 19px; letter-spacing: -0.5px; color: var(--text); text-decoration: none !important; }
  .brand b { color: var(--accent); }
  .nav-links { display: flex; gap: 20px; align-items: center; }
  .nav-links a { font-size: 14px; font-weight: 500; color: var(--muted); }
  .nav-links a:hover { color: var(--accent); text-decoration: none; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 0 24px 80px; }
  .hero { text-align: center; padding: 80px 0 56px; }
  .hero h1 { font-size: 52px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.05; margin: 18px 0 14px; }
  .hero h1 em { font-style: normal; color: var(--accent); }
  .hero p { font-size: 17px; color: var(--muted); max-width: 560px; margin: 0 auto 28px; }
  .hero-cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .feats { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 64px; }
  .feat { padding: 24px; }
  .feat .ic { width: 40px; height: 40px; border-radius: var(--r-md); background: var(--accent-dim); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 19px; margin-bottom: 12px; }
  .feat h3 { font-size: 17px; font-weight: 700; letter-spacing: -0.3px; margin-bottom: 6px; }
  .feat p { font-size: 14px; color: var(--muted); }
  section.docs { margin-bottom: 48px; }
  section.docs h2 { font-size: 28px; font-weight: 800; letter-spacing: -1px; margin-bottom: 6px; }
  section.docs > p { font-size: 15px; color: var(--muted); margin-bottom: 16px; }
  .step { display: flex; gap: 16px; margin: 22px 0; }
  .step-n { flex: 0 0 30px; height: 30px; border-radius: 50%; background: var(--accent); color: #fff; font-family: var(--font-mono); font-size: 13px; display: flex; align-items: center; justify-content: center; margin-top: 2px; }
  .step h3 { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .step p { font-size: 14px; color: var(--muted); margin-bottom: 10px; }
  .step { min-width: 0; }
  .step > div { min-width: 0; flex: 1; }
  .cards-tbl { padding: 4px 16px 12px; margin-top: 14px; }
  footer { border-top: 1px solid var(--border); padding: 28px 32px; text-align: center; }
  footer span { font-family: var(--font-mono); font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--dim); }
  @media (max-width: 640px) { .hero h1 { font-size: 36px; } .hero { padding: 48px 0 36px; } }
</style>
</head>
<body>
<nav class="nav">
	<a class="brand" href="index.php">7<b>Pay</b></a>
	<div class="nav-links">
		<a href="#docs">Docs</a>
		<a href="demo.php">Demo</a>
		<a href="dashboard.php" class="btn btn-ghost btn-sm">Dashboard</a>
	</div>
</nav>

<div class="wrap">
	<div class="hero">
		<span class="badge badge-accent">● 7By's own payment gateway</span>
		<h1>Payments, <em>in-house.</em></h1>
		<p>7Pay powers checkout across every 7By tool — hosted checkout page, a drop-in JS SDK, signed webhooks and a merchant dashboard. No third-party gateway fees.</p>
		<div class="hero-cta">
			<a class="btn btn-primary" href="demo.php">Try the demo checkout</a>
			<a class="btn btn-ghost" href="#docs">Integration docs</a>
		</div>
	</div>

	<div class="feats">
		<div class="card feat"><div class="ic">⚡</div><h3>Hosted checkout</h3><p>Card, UPI, NetBanking and PayPal on a polished payment page. Open it as a modal via the SDK or link to it directly.</p></div>
		<div class="card feat"><div class="ic">🇮🇳</div><h3>Scan &amp; pay UPI</h3><p>Scan-to-pay QR code plus one-tap Google Pay, PhonePe, Paytm and BHIM buttons. Live payments go straight to your VPA — zero gateway commission.</p></div>
		<div class="card feat"><div class="ic">🌍</div><h3>International payments</h3><p>USD, EUR and GBP orders out of the box. Overseas buyers pay by card (test) or PayPal; live PayPal payments are verified by Transaction ID.</p></div>
		<div class="card feat"><div class="ic">🔏</div><h3>Signed like Razorpay</h3><p>HMAC-SHA256 signature over <code class="inline">order_id|payment_id</code> — switching a site between gateways is a one-line change.</p></div>
	</div>

	<section class="docs" id="docs">
		<h2>Integrate in three steps</h2>
		<p>Authenticate with HTTP Basic auth: <code class="inline">key_id:key_secret</code> (registered in <code class="inline">config.php</code>).</p>

		<div class="step">
			<div class="step-n">1</div>
			<div>
				<h3>Create an order (server-side)</h3>
				<p>Amounts are in minor units (paise / cents).</p>
<pre class="code">curl -u 7pay_yourkey:yoursecret \
  -H "Content-Type: application/json" \
  -d '{"amount": 4900, "currency": "INR", "receipt": "u42-1720", "notes": {"plan": "monthly"}}' \
  "https://pay.7by.in/api.php?action=order.create"

# → { "ok": true, "id": "order_…", "amount": 4900, "status": "created", … }</pre>
			</div>
		</div>

		<div class="step">
			<div class="step-n">2</div>
			<div>
				<h3>Open checkout (client-side)</h3>
				<p>Drop in <code class="inline">checkout.js</code> — same shape as Razorpay's SDK.</p>
<pre class="code">&lt;script src="https://pay.7by.in/checkout.js"&gt;&lt;/script&gt;
&lt;script&gt;
var sp = new SevenPay({
  key: '7pay_yourkey',
  order_id: 'order_xxx',
  description: 'Monthly — 1000 credits',
  prefill: { email: 'user@mail.com' },
  handler: function (resp) {
    // send resp.sevenpay_order_id, resp.sevenpay_payment_id,
    // resp.sevenpay_signature to your server to verify
  },
});
sp.on('payment.failed', function (e) { console.log(e); });
sp.open();
&lt;/script&gt;</pre>
			</div>
		</div>

		<div class="step">
			<div class="step-n">3</div>
			<div>
				<h3>Verify the signature (server-side)</h3>
				<p>Never trust the browser — recompute the HMAC with your key secret.</p>
<pre class="code">$expected = hash_hmac('sha256', $order_id . '|' . $payment_id, $key_secret);
if (hash_equals($expected, $signature)) {
    // paid — deliver the goods
}</pre>
			</div>
		</div>

		<h2 style="margin-top:40px">Currencies &amp; methods</h2>
		<p><code class="inline">order.create</code> accepts <code class="inline">INR</code>, <code class="inline">USD</code>, <code class="inline">EUR</code>, <code class="inline">GBP</code> and <code class="inline">AED</code>. Use <code class="inline">gw_geo_currency()</code> (see <code class="inline">demo.php</code>) to price by the visitor's country — India sees ₹, the US sees $, the UAE sees AED, and so on; nobody is shown a foreign currency. UPI (QR scanner + Google Pay / PhonePe / Paytm / BHIM) is shown for INR orders; PayPal covers international currencies. In live mode, UPI settles to your VPA (buyer submits the UTR) and PayPal settles to your PayPal.me (buyer submits the Transaction ID) — both are approved in the dashboard, which fires the <code class="inline">payment.captured</code> webhook.</p>

		<h2 style="margin-top:40px">Webhooks</h2>
		<p>Set a <code class="inline">webhook_url</code> per merchant and 7Pay POSTs signed events — <code class="inline">payment.captured</code>, <code class="inline">payment.pending</code>, <code class="inline">payment.refunded</code>. Verify the <code class="inline">X-7Pay-Signature</code> header: HMAC-SHA256 of the raw body with your <code class="inline">webhook_secret</code>.</p>

		<h2 style="margin-top:40px">Test mode</h2>
		<p>Merchants in <code class="inline">test</code> mode simulate the bank — no real money moves.</p>
		<div class="card cards-tbl">
			<table class="data">
				<thead><tr><th>Input</th><th>Result</th></tr></thead>
				<tbody>
					<tr><td class="mono">4111 1111 1111 1111</td><td>Card success (any valid Luhn number works)</td></tr>
					<tr><td class="mono">4000 0000 0000 0002</td><td>Card declined</td></tr>
					<tr><td class="mono">anything@upi</td><td>UPI success</td></tr>
					<tr><td class="mono">fail@upi</td><td>UPI declined</td></tr>
					<tr><td class="mono">QR / GPay / PhonePe / Paytm / BHIM</td><td>Simulated UPI app payment — success</td></tr>
					<tr><td class="mono">PayPal</td><td>Simulated — instant success (any currency)</td></tr>
				</tbody>
			</table>
		</div>
	</section>
</div>

<footer><span>7Pay · Built by 7By · 7by.in</span></footer>
</body>
</html>
