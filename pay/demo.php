<?php
/**
 * 7Pay — demo store. Proves the whole flow end-to-end with the 7pay_demo
 * test merchant: order.create → checkout.js modal → signature verify.
 * Safe to delete in production.
 */
require __DIR__ . '/lib.php';

$DEMO_KEY = '7pay_demo';
$demo = gw_merchant($DEMO_KEY);

/* Prices per currency (minor units). The visitor sees ONLY their own
   currency — detected from their country (India ₹, USA $, UAE AED, …). */
$PLANS = array(
	'pro' => array(
		'name' => '7By Pro', 'per' => '1,000 credits · 30 days',
		'prices' => array('INR' => 4900, 'USD' => 199, 'EUR' => 179, 'GBP' => 159, 'AED' => 699),
	),
	'yearly' => array(
		'name' => '7By Yearly', 'per' => '20,000 credits · 365 days',
		'prices' => array('INR' => 29900, 'USD' => 599, 'EUR' => 549, 'GBP' => 499, 'AED' => 2199),
	),
);
$currency = gw_geo_currency();

/* ajax: create an order for the picked plan — amount and currency are decided
   server-side (visitor country), so prices can't be tampered with */
if (isset($_GET['ajax']) && $_GET['ajax'] === 'order') {
	$in = gw_body();
	$key = isset($PLANS[$in['product'] ?? '']) ? $in['product'] : 'pro';
	$p = $PLANS[$key];
	$amount = $p['prices'][$currency];
	$order = gw_create_order($demo, $amount, $currency, 'demo-' . time(), array('product' => $key));
	gw_json(array('ok' => true, 'order_id' => $order['id'], 'key_id' => $DEMO_KEY,
		'amount' => $amount, 'label' => $p['name'] . ' — ' . $p['per']));
}

/* ajax: verify the signature exactly like a real merchant server would */
if (isset($_GET['ajax']) && $_GET['ajax'] === 'verify') {
	$in = gw_body();
	$okSig = gw_verify_sign((string)($in['sevenpay_order_id'] ?? ''), (string)($in['sevenpay_payment_id'] ?? ''),
		(string)($in['sevenpay_signature'] ?? ''), $demo['key_secret']);
	gw_json(array('ok' => $okSig, 'error' => $okSig ? null : 'Signature mismatch'));
}
function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Demo store · 7Pay</title>
<link rel="icon" type="image/png" href="favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/pay.css">
<style>
  .nav { height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 32px; position: sticky; top: 0; z-index: 10; }
  .brand { font-weight: 800; font-size: 19px; letter-spacing: -0.5px; color: var(--text); text-decoration: none !important; }
  .brand b { color: var(--accent); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; text-align: center; }
  h1 { font-size: 34px; font-weight: 800; letter-spacing: -1px; margin: 12px 0 8px; }
  .sub { color: var(--muted); font-size: 15px; max-width: 480px; margin: 0 auto 32px; }
  .prods { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; text-align: left; max-width: 640px; margin: 0 auto; }
  .prod { padding: 26px 24px; transition: transform 300ms ease, box-shadow 300ms ease; animation: fadeUp 500ms ease both; }
  .prod:nth-child(2) { animation-delay: 120ms; }
  .prod:hover { transform: translateY(-4px); box-shadow: var(--shadow-pop); }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
  .prod .price { font-size: 34px; font-weight: 800; letter-spacing: -1px; margin: 8px 0 2px; }
  .prod .per { font-family: var(--font-mono); font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); }
  .prod h3 { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .prod ul { list-style: none; margin: 14px 0 20px; }
  .prod li { font-size: 14px; color: var(--muted); padding: 3px 0; }
  .prod li::before { content: '✓ '; color: var(--success); font-weight: 700; }
  .cur-row { display: flex; gap: 8px; justify-content: center; align-items: center; flex-wrap: wrap; margin: 0 0 26px; }
  .cur-pill { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 1px; padding: 5px 13px; border-radius: var(--r-pill); border: 1px solid var(--border-bright); color: var(--muted); background: var(--surface); transition: all 200ms ease; text-decoration: none !important; }
  .cur-pill:hover { border-color: var(--accent); color: var(--accent); }
  .cur-pill.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); font-weight: 500; }
  .geo-note { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
  #result { max-width: 520px; margin: 24px auto 0; text-align: left; display: none; }
  #result pre { margin-top: 8px; }
</style>
</head>
<body>
<nav class="nav">
	<a class="brand" href="index.php">7<b>Pay</b></a>
	<a href="dashboard.php" class="btn btn-ghost btn-sm">Dashboard</a>
</nav>

<div class="wrap">
	<span class="badge badge-test">Test mode demo</span>
	<h1>7Pay Demo Store</h1>
	<p class="sub">A pretend store wired to 7Pay exactly like a real 7By tool would be. Use test card <code class="inline">4111 1111 1111 1111</code>, any future expiry, any CVV.</p>

	<div class="geo-note">Prices in <?php echo e($currency); ?> — detected from your location</div>
	<div class="cur-row">
		<?php foreach (array_keys(gw_currencies()) as $c): ?>
		<a class="cur-pill<?php if ($c === $currency) echo ' active'; ?>" href="?currency=<?php echo $c; ?>"><?php echo $c; ?></a>
		<?php endforeach; ?>
	</div>

	<div class="prods">
		<?php $upiHere = ($currency === 'INR'); ?>
		<div class="card prod">
			<h3><?php echo e($PLANS['pro']['name']); ?></h3>
			<div class="price"><?php echo e(gw_money($PLANS['pro']['prices'][$currency], $currency)); ?></div>
			<div class="per"><?php echo e($PLANS['pro']['per']); ?></div>
			<ul>
				<li><?php echo $upiHere ? 'UPI · GPay · PhonePe · Cards' : 'Cards · PayPal'; ?></li>
				<li>Instant payment confirmation</li>
				<li>Signature-verified &amp; secure</li>
			</ul>
			<button class="btn btn-primary btn-block" data-buy="pro">Pay <?php echo e(gw_money($PLANS['pro']['prices'][$currency], $currency)); ?></button>
		</div>
		<div class="card prod">
			<h3><?php echo e($PLANS['yearly']['name']); ?></h3>
			<div class="price"><?php echo e(gw_money($PLANS['yearly']['prices'][$currency], $currency)); ?></div>
			<div class="per"><?php echo e($PLANS['yearly']['per']); ?></div>
			<ul>
				<li><?php echo $upiHere ? 'Scan &amp; pay QR supported' : 'PayPal buyer protection'; ?></li>
				<li>One payment for the whole year</li>
				<li>Refund-ready from the dashboard</li>
			</ul>
			<button class="btn btn-primary btn-block" data-buy="yearly">Pay <?php echo e(gw_money($PLANS['yearly']['prices'][$currency], $currency)); ?></button>
		</div>
	</div>

	<div id="result" class="card" style="padding:20px 22px">
		<span class="mono-label" id="resTitle">Result</span>
		<pre class="code" id="resBody"></pre>
	</div>
</div>

<script src="checkout.js"></script>
<script>
(function () {
  function $(s) { return document.querySelector(s); }
  function showResult(title, obj, ok) {
    $('#result').style.display = 'block';
    $('#resTitle').textContent = title;
    $('#resTitle').style.color = ok ? 'var(--success)' : 'var(--error)';
    $('#resBody').textContent = JSON.stringify(obj, null, 2);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  document.querySelectorAll('[data-buy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fetch('demo.php?ajax=order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: btn.dataset.buy }),
      }).then(function (r) { return r.json(); }).then(function (o) {
        btn.disabled = false;
        if (!o.ok) return showResult('Order failed', o, false);
        var sp = new SevenPay({
          key: o.key_id,
          order_id: o.order_id,
          description: o.label,
          prefill: { email: 'demo@7by.in' },
          handler: function (resp) {
            // verify server-side, like a real integration
            fetch('demo.php?ajax=verify', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resp),
            }).then(function (r) { return r.json(); }).then(function (v) {
              showResult(v.ok ? '✓ Payment verified — signature valid' : '✕ Verification failed',
                { payment: resp, verify: v }, v.ok);
            });
          },
          modal: { ondismiss: function () { showResult('Checkout dismissed', { dismissed: true }, false); } },
        });
        sp.on('payment.failed', function (e) { console.log('payment.failed', e); });
        sp.open();
      }).catch(function () { btn.disabled = false; });
    });
  });
})();
</script>
</body>
</html>
