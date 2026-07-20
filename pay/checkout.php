<?php
/**
 * 7Pay — hosted checkout page.
 * Opened as /checkout.php?order_id=order_xxx&key_id=xxx[&embed=1][&description=...]
 * - Standalone: on success redirects to the order's callback_url (if set).
 * - Embedded (checkout.js modal): posts sevenpay:success / :failed / :dismiss
 *   messages to the parent window.
 */
require __DIR__ . '/lib.php';

$keyId   = isset($_GET['key_id']) ? $_GET['key_id'] : '';
$orderId = isset($_GET['order_id']) ? $_GET['order_id'] : '';
$embed   = !empty($_GET['embed']);
$desc    = isset($_GET['description']) ? substr($_GET['description'], 0, 140) : '';
$prefillEmail   = isset($_GET['email']) ? substr($_GET['email'], 0, 190) : '';
$prefillContact = isset($_GET['contact']) ? substr($_GET['contact'], 0, 20) : '';

$merchant = gw_merchant($keyId);
$order = gw_get_order($orderId);
$err = '';
if (!$merchant) $err = 'Unknown merchant key.';
elseif (!$order || $order['merchant_key'] !== $keyId) $err = 'This payment link is invalid or has expired.';

$isTest = $merchant ? ($merchant['mode'] !== 'live') : true;
$alreadyPaid = $order && $order['status'] === 'paid';
$amountText = $order ? gw_money($order['amount'], $order['currency']) : '';
$currency = $order ? $order['currency'] : 'INR';
$upiOk = ($currency === 'INR'); // UPI is an INR rail
$upiAuto = !$isTest && gw_upi_auto_on(); // bank-SMS auto-detection configured

// Auto-detect mode: reserve this order's pending payment NOW with a unique
// pay-amount (base + 0–99 paise) so the bank credit identifies exactly this
// buyer — many buyers can pay in the same minute and all auto-verify. The
// page polls it from load, so it completes even without a button tap.
$upiPendingId = '';
$upiPayAmount = $order ? (int)$order['amount'] : 0;
if ($order && !$alreadyPaid && $upiOk && $upiAuto) {
	list($upiPendingId, $upiPayAmount) = gw_upi_reserve($order);
}
$upiAmountText = gw_money($upiPayAmount, 'INR');

// UPI deep links — same params work for Google Pay, PhonePe, Paytm, BHIM.
// In test mode the QR/app buttons point at a dummy VPA and are simulated.
$upiVpa = $isTest ? 'test@7pay' : $GW['upi']['vpa'];
$upiPayee = $GW['upi']['payee'];
$upiParams = $order ? 'pa=' . rawurlencode($upiVpa) . '&pn=' . rawurlencode($upiPayee)
	. '&am=' . rawurlencode(number_format($upiPayAmount / 100, 2, '.', ''))
	. '&cu=INR&tn=' . rawurlencode($order['id']) : '';
$upiLink = 'upi://pay?' . $upiParams;
$upiApps = array(
	'gpay'    => array('label' => 'GPay',    'href' => 'tez://upi/pay?' . $upiParams),
	'phonepe' => array('label' => 'PhonePe', 'href' => 'phonepe://pay?' . $upiParams),
	'paytm'   => array('label' => 'Paytm',   'href' => 'paytmmp://pay?' . $upiParams),
	'bhim'    => array('label' => 'BHIM',    'href' => $upiLink),
);

// PayPal (international) — live: PayPal.me link with the amount appended.
$paypalMe = rtrim((string)($GW['paypal']['me_link'] ?? ''), '/');
$paypalHref = ($order && $paypalMe)
	? $paypalMe . '/' . number_format($order['amount'] / 100, 2, '.', '') . $currency : '';

$mName = $merchant ? $merchant['name'] : '7Pay';
$initial = strtoupper(mb_substr($mName, 0, 1));
function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Pay <?php echo e($amountText); ?> — <?php echo e($mName); ?> · 7Pay</title>
<link rel="icon" type="image/png" href="favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/pay.css">
<style>
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: <?php echo $embed ? '0' : '24px 16px'; ?>; <?php if ($embed) echo 'background: transparent;'; ?> }
  .checkout { width: 100%; max-width: 420px; overflow: hidden; position: relative; }
  .co-head { background: linear-gradient(135deg, #4F46E5, #6D28D9); color: #fff; padding: 22px 24px 18px; position: relative; }
  @media (prefers-reduced-motion: reduce) { .checkout { animation: none; } }
  .co-close { position: absolute; top: 14px; right: 14px; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(255,255,255,0.18); color: #fff; font-size: 15px; line-height: 1; cursor: pointer; }
  .co-close:hover { background: rgba(255,255,255,0.3); }
  .co-merchant { display: flex; align-items: center; gap: 12px; }
  .co-avatar { width: 42px; height: 42px; border-radius: var(--r-md); background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 19px; overflow: hidden; }
  .co-avatar img { width: 100%; height: 100%; object-fit: contain; background: #fff; border-radius: inherit; padding: 6px; box-sizing: border-box; }
  .co-mname { font-weight: 700; font-size: 17px; line-height: 1.25; }
  .co-desc { font-size: 12.5px; opacity: 0.78; }
  .co-amount { margin-top: 14px; display: flex; align-items: baseline; justify-content: space-between; }
  .co-amount .val { font-size: 32px; font-weight: 800; letter-spacing: -1px; }
  .co-order { font-family: var(--font-mono); font-size: 10.5px; opacity: 0.65; letter-spacing: 0.5px; }
  .co-test { background: var(--warn-dim); color: var(--warn); font-family: var(--font-mono); font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; text-align: center; padding: 7px 12px; border-bottom: 1px solid rgba(217,119,6,0.15); }
  .co-body { padding: 20px 24px 24px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 18px; }
  .tab { flex: 1; font-family: var(--font-mono); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; text-align: center; padding: 9px 4px; border-radius: var(--r-md); border: 1px solid var(--border-bright); background: var(--surface); color: var(--muted); cursor: pointer; transition: all 200ms ease; }
  .tab.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); font-weight: 500; }
  .row2 { display: flex; gap: 12px; }
  .row2 .field { flex: 1; }
  .banks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
  .bank { border: 1px solid var(--border-bright); border-radius: var(--r-md); background: var(--surface); padding: 10px 6px; font-size: 12.5px; font-weight: 600; text-align: center; cursor: pointer; transition: all 200ms ease; color: var(--text); }
  .bank.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
  .apps { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 2px 0 12px; }
  .app { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-bright); border-radius: var(--r-pill); background: var(--surface); padding: 7px 14px; font-family: var(--font-body); font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none !important; transition: all 200ms ease; }
  .app:hover { transform: translateY(-1px); border-color: currentColor; }
  .app-gpay { color: #4285F4; } .app-phonepe { color: #5F259F; } .app-paytm { color: #00BAF2; } .app-bhim { color: #F26B21; }
  .pp-btn { background: #FFC439; color: #003087 !important; border: 0; font-weight: 700; }
  .pp-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
  .upi-live-box { text-align: center; padding: 6px 0 2px; }
  #qrBox { width: 168px; height: 168px; margin: 0 auto 10px; background: #fff; border: 1px solid var(--border-bright); border-radius: var(--r-lg); display: flex; align-items: center; justify-content: center; padding: 8px; }
  #qrBox img, #qrBox canvas { max-width: 100%; max-height: 100%; }
  .vpa-line { font-family: var(--font-mono); font-size: 13px; color: var(--text); background: var(--surface-2); border-radius: var(--r-md); padding: 8px 12px; display: inline-block; margin-bottom: 12px; }
  .divider { display: flex; align-items: center; gap: 10px; color: var(--dim); font-family: var(--font-mono); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; margin: 16px 0; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border-bright); }
  .co-foot { text-align: center; padding: 14px; border-top: 1px solid var(--border); }
  .co-foot span { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--dim); }
  /* entrance */
  @keyframes coIn { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: none; } }
  .checkout { animation: coIn 450ms ease both; }
  .btn-primary:active { transform: scale(0.98); }
  /* result states */
  .state { text-align: center; padding: 44px 28px 40px; }
  .state .icon { width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 30px; }
  @keyframes popIn { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
  .state .icon { animation: popIn 400ms ease both; }
  .icon-ok { background: var(--success-dim); color: var(--success); }
  @keyframes glowPulse { from { box-shadow: 0 0 0 0 rgba(5,150,105,0.35); } to { box-shadow: 0 0 0 26px rgba(5,150,105,0); } }
  .icon-ok { animation: popIn 400ms ease both, glowPulse 1.1s ease 350ms 2; }
  .icon-wait { background: var(--warn-dim); color: var(--warn); }
  @keyframes waitPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
  .icon-wait { animation: popIn 400ms ease both, waitPulse 1.8s ease 600ms infinite; }
  .icon-err { background: var(--error-dim); color: var(--error); }
  /* animated checkmark (SVG stroke draw) */
  .check { display: block; }
  .check circle { fill: none; stroke: var(--success); stroke-width: 2.5; stroke-dasharray: 151; stroke-dashoffset: 151; animation: draw 600ms ease 150ms forwards; }
  .check path { fill: none; stroke: var(--success); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: draw 350ms ease 600ms forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  /* indeterminate progress bar while "talking to the bank" */
  .progress { position: relative; height: 4px; border-radius: 2px; background: var(--accent-dim); overflow: hidden; margin: 22px auto 0; max-width: 220px; }
  .progress::after { content: ''; position: absolute; top: 0; left: -40%; width: 40%; height: 100%; border-radius: 2px; background: var(--accent); animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { to { left: 100%; } }
  .state h2, .state p { animation: coIn 400ms ease 150ms both; }
  .state h2 { font-size: 21px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
  .state p { font-size: 14px; color: var(--muted); }
  .state .mono-id { font-family: var(--font-mono); font-size: 12px; color: var(--dim); margin-top: 12px; word-break: break-all; }
  .hidden { display: none !important; }
  @media (max-width: 460px) { .co-body { padding: 16px; } .co-head { padding: 18px 16px 14px; } }
</style>
</head>
<body>
<div class="checkout card" id="checkout">
<?php if ($err): ?>
	<div class="state">
		<div class="icon icon-err">✕</div>
		<h2>Can't load this payment</h2>
		<p><?php echo e($err); ?></p>
	</div>
<?php elseif ($alreadyPaid): ?>
	<div class="state">
		<div class="icon icon-ok">✓</div>
		<h2>Already paid</h2>
		<p>This order has already been paid. You're all set.</p>
		<div class="mono-id"><?php echo e($order['id']); ?></div>
	</div>
<?php else: ?>
	<div class="co-head">
		<?php if ($embed): ?><button class="co-close" id="closeBtn" aria-label="Close">✕</button><?php endif; ?>
		<div class="co-merchant">
			<div class="co-avatar"><?php if (file_exists(__DIR__ . '/logo.png')): ?><img src="logo.png" alt="<?php echo e($mName); ?>"><?php else: echo e($initial); endif; ?></div>
			<div>
				<div class="co-mname"><?php echo e($mName); ?></div>
				<div class="co-desc"><?php echo e($desc ?: 'Secure checkout'); ?></div>
			</div>
		</div>
		<div class="co-amount">
			<span class="val"><?php echo e($amountText); ?></span>
			<span class="co-order"><?php echo e($order['id']); ?></span>
		</div>
	</div>
	<?php if ($isTest): ?><div class="co-test">Test mode — no real money moves</div><?php endif; ?>

	<div class="co-body" id="payBody">
		<div class="row2">
			<div class="field"><label for="email">Email</label>
				<input class="input" id="email" type="email" placeholder="you@email.com" value="<?php echo e($prefillEmail); ?>"></div>
			<div class="field"><label for="contact">Phone</label>
				<input class="input" id="contact" type="tel" placeholder="98765 43210" value="<?php echo e($prefillContact); ?>"></div>
		</div>

		<?php $defaultTab = $isTest ? 'card' : ($upiOk ? 'upi' : 'paypal'); ?>
		<div class="tabs" id="tabs">
			<?php if ($isTest): ?><button class="tab<?php if ($defaultTab === 'card') echo ' active'; ?>" data-tab="card">Card</button><?php endif; ?>
			<?php if ($upiOk): ?><button class="tab<?php if ($defaultTab === 'upi') echo ' active'; ?>" data-tab="upi">7Pay</button><?php endif; ?>
			<?php if ($isTest): ?><button class="tab" data-tab="netbanking">NetBank</button><?php endif; ?>
			<button class="tab<?php if ($defaultTab === 'paypal') echo ' active'; ?>" data-tab="paypal">PayPal</button>
		</div>

		<?php if ($isTest): ?>
		<!-- CARD (test) -->
		<div class="panel<?php if ($defaultTab !== 'card') echo ' hidden'; ?>" data-panel="card">
			<div class="field"><label for="cardNum">Card number</label>
				<input class="input mono" id="cardNum" inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111" maxlength="23"></div>
			<div class="row2">
				<div class="field"><label for="cardExp">Expiry</label>
					<input class="input mono" id="cardExp" inputmode="numeric" placeholder="MM / YY" maxlength="7"></div>
				<div class="field"><label for="cardCvv">CVV</label>
					<input class="input mono" id="cardCvv" inputmode="numeric" type="password" placeholder="•••" maxlength="4"></div>
			</div>
			<div class="field"><label for="cardName">Name on card</label>
				<input class="input" id="cardName" autocomplete="cc-name" placeholder="As printed on the card"></div>
		</div>
		<?php endif; ?>

		<?php if ($upiOk): ?>
		<!-- UPI — scan the QR or tap an app (Google Pay / PhonePe / Paytm / BHIM).
		     Test mode: dummy VPA, app taps are simulated. Live: real deep links. -->
		<div class="panel<?php if ($defaultTab !== 'upi') echo ' hidden'; ?>" data-panel="upi">
			<div class="upi-live-box">
				<div id="qrBox"><span class="mono-label">QR</span></div>
				<div class="vpa-line">🔒 7Pay · Secure UPI</div>
				<?php if ($upiAuto && !$isTest): ?>
				<div style="font-family:var(--font-mono);font-size:13.5px;font-weight:600;color:var(--accent);margin:-4px 0 10px">Pay exactly <?php echo e($upiAmountText); ?></div>
				<?php endif; ?>
				<div class="apps">
					<?php foreach ($upiApps as $slug => $app): ?>
					<?php if ($isTest): ?>
					<button class="app app-<?php echo $slug; ?>" data-app="<?php echo $slug; ?>"><?php echo e($app['label']); ?></button>
					<?php else: ?>
					<a class="app app-<?php echo $slug; ?>" href="<?php echo e($app['href']); ?>"><?php echo e($app['label']); ?></a>
					<?php endif; ?>
					<?php endforeach; ?>
				</div>
			</div>
			<?php if ($isTest): ?>
			<div class="divider">or pay with UPI ID</div>
			<div class="field"><label for="vpa">UPI ID</label>
				<input class="input mono" id="vpa" placeholder="yourname@upi"></div>
			<p style="font-size:12.5px;color:var(--muted);margin-bottom:14px">Test mode: scanning and app buttons are simulated. Any valid UPI ID succeeds; one containing “fail” is declined.</p>
			<?php elseif ($upiAuto): ?>
			<div class="divider">after paying</div>
			<div class="field"><label for="utr">UTR <span style="text-transform:none;letter-spacing:0;color:var(--dim)">(optional)</span></label>
				<input class="input mono" id="utr" placeholder="Leave empty — we detect it automatically"></div>
			<p style="font-size:12.5px;color:var(--muted);margin-bottom:14px">Scan the QR or tap your app — the amount <b><?php echo e($upiAmountText); ?></b> is filled in for you. Pay it <b>exactly</b> (those few paise identify <i>your</i> payment). This page completes <b>automatically</b> the moment your money arrives — usually within a minute.</p>
			<?php else: ?>
			<div class="divider">then confirm</div>
			<div class="field"><label for="utr">UTR / Transaction reference</label>
				<input class="input mono" id="utr" placeholder="12-digit ref from your UPI app"></div>
			<p style="font-size:12.5px;color:var(--muted);margin-bottom:14px">Scan the QR or tap your UPI app to pay <?php echo e($amountText); ?>, then paste the UTR from the payment receipt. We verify and confirm shortly.</p>
			<?php endif; ?>
		</div>
		<?php endif; ?>

		<?php if ($isTest): ?>
		<!-- NETBANKING (test) -->
		<div class="panel hidden" data-panel="netbanking">
			<div class="banks" id="banks">
				<?php foreach (array('HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak', 'PNB') as $b): ?>
				<button class="bank" data-bank="<?php echo $b; ?>"><?php echo $b; ?></button>
				<?php endforeach; ?>
			</div>
		</div>
		<?php endif; ?>

		<!-- PAYPAL — international payments (any currency) -->
		<div class="panel<?php if ($defaultTab !== 'paypal') echo ' hidden'; ?>" data-panel="paypal">
			<?php if ($isTest): ?>
			<p style="font-size:13.5px;color:var(--muted);margin:4px 0 14px">Pay <?php echo e($amountText); ?> with PayPal — works for international cards and balances in USD, EUR, GBP and more. <b>Test mode: simulated, no real money.</b></p>
			<?php else: ?>
			<div style="text-align:center;padding:4px 0 2px">
				<a class="btn pp-btn" href="<?php echo e($paypalHref); ?>" target="_blank" rel="noopener"><b>Pay</b>Pal — <?php echo e($amountText); ?> →</a>
				<div class="divider">then confirm</div>
			</div>
			<div class="field"><label for="txn">PayPal Transaction ID</label>
				<input class="input mono" id="txn" placeholder="e.g. 8AB12345CD678901E"></div>
			<p style="font-size:12.5px;color:var(--muted);margin-bottom:14px">Complete the payment in the PayPal tab, then paste the Transaction ID from your receipt email or Activity page. We verify and confirm shortly.</p>
			<?php endif; ?>
		</div>

		<div class="msg msg-err hidden" id="payErr"></div>
		<button class="btn btn-primary btn-block" id="payBtn">Pay <?php echo e($amountText); ?></button>
	</div>

	<!-- processing / success / pending states -->
	<div class="state hidden" id="stateProcessing">
		<div class="icon" style="background:var(--accent-dim)"><span class="spinner"></span></div>
		<h2>Processing…</h2><p>Talking to the bank. Don't close this window.</p>
		<div class="progress"></div>
	</div>
	<div class="state hidden" id="stateSuccess">
		<div class="icon icon-ok"><svg class="check" viewBox="0 0 52 52" width="38" height="38" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27.5l7.5 7.5L37 19"/></svg></div>
		<h2>Payment successful</h2>
		<p><?php echo e($amountText); ?> paid to <?php echo e($mName); ?></p>
		<div class="mono-id" id="successPid"></div>
	</div>
	<div class="state hidden" id="statePending">
		<div class="icon icon-wait">⏳</div>
		<?php if ($upiAuto): ?>
		<h2>Waiting for your payment…</h2>
		<p id="pendingMsg">Keep this window open — it completes <b>automatically</b> the moment your payment arrives (usually under a minute).</p>
		<?php else: ?>
		<h2>Awaiting verification</h2>
		<p>We've recorded your payment reference. Your payment will be confirmed once it's verified — usually within a few minutes.</p>
		<?php endif; ?>
		<div class="mono-id" id="pendingPid"></div>
	</div>

	<div class="co-foot"><span>🔒 Secured by 7Pay · 7by.in</span></div>
<?php endif; ?>
</div>

<?php if (!$err && !$alreadyPaid): ?>
<?php if ($upiOk): ?><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><?php endif; ?>
<script>
(function () {
  var EMBED = <?php echo $embed ? 'true' : 'false'; ?>;
  var KEY = <?php echo json_encode($keyId); ?>;
  var ORDER = <?php echo json_encode($order['id']); ?>;
  var CALLBACK = <?php echo json_encode($order['callback_url']); ?>;
  var IS_TEST = <?php echo $isTest ? 'true' : 'false'; ?>;
  var UPI_AUTO = <?php echo $upiAuto ? 'true' : 'false'; ?>;
  var UPI_PENDING = <?php echo json_encode($upiPendingId); ?>; // reserved payment (auto-detect)
  var UPI_LINK = <?php echo json_encode($upiLink); ?>;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function post(msg) { if (EMBED && window.parent !== window) window.parent.postMessage(msg, '*'); }

  /* UPI QR — scan-to-pay code (test: dummy VPA; live: real) */
  if (window.QRCode && $('#qrBox')) {
    $('#qrBox').innerHTML = '';
    new QRCode($('#qrBox'), { text: UPI_LINK, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
  }

  /* tabs */
  var method = $('#tabs .tab.active').dataset.tab;
  var PAY_LABEL = $('#payBtn').textContent;
  function syncPayLabel() {
    // Auto-detected UPI: the buyer pays in their app first, then confirms here.
    $('#payBtn').textContent = (method === 'upi' && !IS_TEST && UPI_AUTO) ? 'I’ve paid — confirm' : PAY_LABEL;
  }
  syncPayLabel();
  $$('#tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('#tabs .tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      method = t.dataset.tab;
      $$('.panel').forEach(function (p) { p.classList.toggle('hidden', p.dataset.panel !== method); });
      err('');
      syncPayLabel();
    });
  });

  /* UPI app buttons — test mode: simulate paying through that app */
  $$('.app[data-app]').forEach(function (a) {
    a.addEventListener('click', function () {
      var vpaEl = $('#vpa');
      if (vpaEl) vpaEl.value = 'buyer@' + a.dataset.app;
      method = 'upi';
      $('#payBtn').click();
    });
  });

  /* bank picker */
  var bank = '';
  $$('#banks .bank').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#banks .bank').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active'); bank = b.dataset.bank;
    });
  });

  /* card input formatting */
  var num = $('#cardNum'), exp = $('#cardExp');
  if (num) num.addEventListener('input', function () {
    var v = num.value.replace(/\D/g, '').slice(0, 19);
    num.value = v.replace(/(.{4})/g, '$1 ').trim();
  });
  if (exp) exp.addEventListener('input', function () {
    var v = exp.value.replace(/\D/g, '').slice(0, 4);
    exp.value = v.length > 2 ? v.slice(0, 2) + ' / ' + v.slice(2) : v;
  });

  function err(m) {
    var el = $('#payErr');
    el.textContent = m || '';
    el.classList.toggle('hidden', !m);
  }
  function show(id) {
    ['payBody', 'stateProcessing', 'stateSuccess', 'statePending'].forEach(function (s) {
      $('#' + s).classList.toggle('hidden', s !== id);
    });
  }

  function succeed(data) {
    $('#successPid').textContent = data.sevenpay_payment_id;
    show('stateSuccess');
    setTimeout(function () {
      if (EMBED) post({ type: 'sevenpay:success', data: data });
      else if (CALLBACK) {
        var q = 'sevenpay_order_id=' + encodeURIComponent(data.sevenpay_order_id)
          + '&sevenpay_payment_id=' + encodeURIComponent(data.sevenpay_payment_id)
          + '&sevenpay_signature=' + encodeURIComponent(data.sevenpay_signature);
        location.href = CALLBACK + (CALLBACK.indexOf('?') >= 0 ? '&' : '?') + q;
      }
    }, 1900); // let the checkmark animation finish before handing back
  }

  var closeBtn = $('#closeBtn');
  if (closeBtn) closeBtn.addEventListener('click', function () { post({ type: 'sevenpay:dismiss' }); });

  $('#payBtn').addEventListener('click', function () {
    err('');
    var body = {
      key_id: KEY, order_id: ORDER, method: method,
      email: $('#email').value.trim(), contact: $('#contact').value.trim(),
    };
    if (method === 'card') {
      body.card = {
        number: (num ? num.value : ''), expiry: (exp ? exp.value : ''),
        cvv: $('#cardCvv').value, name: $('#cardName').value,
      };
      if (body.card.number.replace(/\D/g, '').length < 12) return err('Enter your card number.');
    }
    if (method === 'upi' && IS_TEST) {
      body.vpa = $('#vpa').value.trim();
      if (!body.vpa) return err('Enter your UPI ID.');
    }
    if (method === 'upi' && !IS_TEST) {
      body.utr = $('#utr').value.trim();
      // With auto-detect on, the UTR is optional — the bank webhook confirms.
      if (!body.utr && !UPI_AUTO) return err('Paste the UTR from your UPI app after paying.');
      if (UPI_PENDING) body.payment_id = UPI_PENDING; // attach to the reserved payment
    }
    if (method === 'netbanking') {
      body.bank = bank;
      if (!bank) return err('Choose your bank.');
    }
    if (method === 'paypal' && !IS_TEST) {
      body.txn = $('#txn').value.trim();
      if (!body.txn) return err('Paste the Transaction ID from your PayPal receipt.');
    }

    show('stateProcessing');
    var t0 = Date.now();
    fetch('api.php?action=checkout.pay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).then(function (j) {
      // keep the "processing" beat ≥ 1.1s so it reads as a real authorization
      var wait = Math.max(0, 1100 - (Date.now() - t0));
      setTimeout(function () {
        if (j.ok && j.status === 'captured') return succeed(j);
        if (j.ok && j.status === 'pending') {
          $('#pendingPid').textContent = j.payment_id;
          show('statePending');
          poll(j.payment_id);
          return;
        }
        show('payBody');
        err(j.error || 'Payment failed. Please try again.');
        post({ type: 'sevenpay:failed', data: { error: j.error || 'failed' } });
      }, wait);
    }).catch(function () {
      show('payBody');
      err('Network error. Please try again.');
    });
  });

  /* live UPI: poll until captured (auto-detected or dashboard-approved) */
  var pollTimer = null;
  function poll(pid) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      fetch('api.php?action=checkout.status&key_id=' + encodeURIComponent(KEY) + '&payment_id=' + encodeURIComponent(pid))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.status === 'captured') { clearInterval(pollTimer); succeed(j); }
          if (j.status === 'failed') { clearInterval(pollTimer); show('payBody'); err('Payment could not be verified.'); }
        }).catch(function () {});
    }, 5000);
  }

  /* Auto-detect: the payment is reserved from page load, so start watching
     immediately — the page completes even if the buyer never taps a button. */
  if (UPI_PENDING) poll(UPI_PENDING);

  /* Banks sometimes confirm late — after 90s of waiting, reassure the buyer
     that leaving is safe (capture + credits happen server-side regardless). */
  if (UPI_AUTO) setTimeout(function () {
    var m = $('#pendingMsg');
    if (m) m.innerHTML = 'Your bank is taking a little longer than usual — that’s normal. ' +
      'If you’ve paid, <b>you can safely close this page</b>: your payment confirms automatically ' +
      'in the background and your purchase completes on its own.';
  }, 90000);
})();
</script>
<?php endif; ?>
</body>
</html>
