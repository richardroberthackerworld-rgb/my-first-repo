<?php
/**
 * 7Pay — shared helpers: DB (sqlite/mysql + auto-migrate), ids, merchant auth,
 * payment signatures, webhooks, JSON I/O.
 */

$GW = require __DIR__ . '/config.php';

/* ---------------- JSON I/O ---------------- */
function gw_json($data, $code = 200) {
	http_response_code($code);
	header('Content-Type: application/json');
	echo json_encode($data);
	exit;
}
function gw_fail($msg, $code = 400) { gw_json(array('ok' => false, 'error' => $msg), $code); }

function gw_body() {
	$raw = file_get_contents('php://input');
	$j = json_decode($raw, true);
	return is_array($j) ? $j : $_POST;
}

function gw_now() { return date('Y-m-d H:i:s'); }

/* ---------------- Database (PDO, sqlite or mysql) + auto-migrate ---------------- */
function gw_db() {
	global $GW;
	static $pdo = null;
	if ($pdo) return $pdo;
	$d = $GW['db'];
	if ($d['driver'] === 'sqlite') {
		$dir = dirname($d['sqlite_path']);
		if (!is_dir($dir)) mkdir($dir, 0755, true);
		$pdo = new PDO('sqlite:' . $d['sqlite_path']);
		$auto = ''; // sqlite: INTEGER PRIMARY KEY autoincrements by itself
	} else {
		$pdo = new PDO(
			"mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4",
			$d['user'], $d['pass']
		);
		$auto = ' AUTO_INCREMENT';
	}
	$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
	$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

	// Portable column types: TEXT/VARCHAR + INTEGER work on both engines.
	$vc = ($d['driver'] === 'sqlite') ? 'TEXT' : 'VARCHAR(190)';
	$pdo->exec("CREATE TABLE IF NOT EXISTS gw_orders (
		id $vc PRIMARY KEY,
		merchant_key $vc NOT NULL,
		amount INTEGER NOT NULL,
		currency $vc NOT NULL DEFAULT 'INR',
		receipt $vc NULL,
		notes TEXT NULL,
		callback_url TEXT NULL,
		status $vc NOT NULL DEFAULT 'created',
		created_at $vc NOT NULL
	)");
	$pdo->exec("CREATE TABLE IF NOT EXISTS gw_payments (
		id $vc PRIMARY KEY,
		order_id $vc NOT NULL,
		merchant_key $vc NOT NULL,
		method $vc NULL,
		status $vc NOT NULL DEFAULT 'created',
		amount INTEGER NOT NULL,
		currency $vc NOT NULL DEFAULT 'INR',
		email $vc NULL,
		contact $vc NULL,
		vpa $vc NULL,
		utr $vc NULL,
		bank $vc NULL,
		card_last4 $vc NULL,
		card_network $vc NULL,
		error TEXT NULL,
		created_at $vc NOT NULL,
		updated_at $vc NOT NULL
	)");
	$pdo->exec("CREATE TABLE IF NOT EXISTS gw_webhooks (
		id INTEGER PRIMARY KEY$auto,
		merchant_key $vc NOT NULL,
		payment_id $vc NULL,
		event $vc NOT NULL,
		http_code INTEGER NULL,
		created_at $vc NOT NULL
	)");
	return $pdo;
}

/* ---------------- Ids ---------------- */
function gw_id($prefix) { return $prefix . bin2hex(random_bytes(9)); } // e.g. order_a1b2..., pay_...

/* ---------------- Merchants + auth ---------------- */
function gw_merchant($keyId) {
	global $GW;
	if (!$keyId || empty($GW['merchants'][$keyId])) return null;
	$m = $GW['merchants'][$keyId];
	$m['key_id'] = $keyId;
	return $m;
}

// API auth, Razorpay-style: HTTP Basic with key_id:key_secret.
function gw_merchant_from_auth() {
	$user = isset($_SERVER['PHP_AUTH_USER']) ? $_SERVER['PHP_AUTH_USER'] : '';
	$pass = isset($_SERVER['PHP_AUTH_PW'])   ? $_SERVER['PHP_AUTH_PW']   : '';
	// Some cPanel/CGI setups strip PHP_AUTH_*; also accept the raw header.
	if ($user === '') {
		$hdr = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION']
			: (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) ? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] : '');
		if (stripos($hdr, 'Basic ') === 0) {
			$dec = base64_decode(substr($hdr, 6));
			if ($dec && strpos($dec, ':') !== false) list($user, $pass) = explode(':', $dec, 2);
		}
	}
	$m = gw_merchant($user);
	if (!$m || !hash_equals($m['key_secret'], (string)$pass)) return null;
	return $m;
}

function gw_require_merchant() {
	$m = gw_merchant_from_auth();
	if (!$m) {
		header('WWW-Authenticate: Basic realm="7Pay API"');
		gw_fail('Authentication failed. Use HTTP Basic auth with key_id:key_secret.', 401);
	}
	return $m;
}

/* ---------------- Signatures (HMAC-SHA256, Razorpay-compatible scheme) ---------------- */
function gw_sign($orderId, $paymentId, $secret) {
	return hash_hmac('sha256', $orderId . '|' . $paymentId, $secret);
}
function gw_verify_sign($orderId, $paymentId, $signature, $secret) {
	return hash_equals(gw_sign($orderId, $paymentId, $secret), (string)$signature);
}

/* ---------------- Orders + payments ---------------- */
function gw_get_order($id) {
	$st = gw_db()->prepare('SELECT * FROM gw_orders WHERE id = ?');
	$st->execute(array($id));
	return $st->fetch() ?: null;
}
function gw_get_payment($id) {
	$st = gw_db()->prepare('SELECT * FROM gw_payments WHERE id = ?');
	$st->execute(array($id));
	return $st->fetch() ?: null;
}

function gw_create_order($merchant, $amount, $currency, $receipt = '', $notes = null, $callbackUrl = '') {
	$id = gw_id('order_');
	gw_db()->prepare('INSERT INTO gw_orders (id, merchant_key, amount, currency, receipt, notes, callback_url, status, created_at)
		VALUES (?,?,?,?,?,?,?,?,?)')
		->execute(array($id, $merchant['key_id'], (int)$amount, $currency, $receipt,
			$notes ? json_encode($notes) : null, $callbackUrl, 'created', gw_now()));
	return gw_get_order($id);
}

function gw_public_order($o) {
	if (!$o) return null;
	return array(
		'id' => $o['id'], 'entity' => 'order', 'amount' => (int)$o['amount'],
		'currency' => $o['currency'], 'receipt' => $o['receipt'],
		'notes' => $o['notes'] ? json_decode($o['notes'], true) : new stdClass(),
		'status' => $o['status'], 'created_at' => $o['created_at'],
	);
}

function gw_public_payment($p) {
	if (!$p) return null;
	return array(
		'id' => $p['id'], 'entity' => 'payment', 'order_id' => $p['order_id'],
		'amount' => (int)$p['amount'], 'currency' => $p['currency'],
		'status' => $p['status'], 'method' => $p['method'],
		'email' => $p['email'], 'contact' => $p['contact'],
		'vpa' => $p['vpa'], 'utr' => $p['utr'], 'bank' => $p['bank'],
		'card_last4' => $p['card_last4'], 'card_network' => $p['card_network'],
		'error' => $p['error'], 'created_at' => $p['created_at'],
	);
}

/* ---------------- Cards (test mode) ---------------- */
function gw_luhn_ok($num) {
	$num = preg_replace('/\D/', '', $num);
	if (strlen($num) < 12 || strlen($num) > 19) return false;
	$sum = 0; $alt = false;
	for ($i = strlen($num) - 1; $i >= 0; $i--) {
		$n = (int)$num[$i];
		if ($alt) { $n *= 2; if ($n > 9) $n -= 9; }
		$sum += $n; $alt = !$alt;
	}
	return $sum % 10 === 0;
}
function gw_card_network($num) {
	$num = preg_replace('/\D/', '', $num);
	if (preg_match('/^4/', $num)) return 'Visa';
	if (preg_match('/^5[1-5]/', $num) || preg_match('/^2[2-7]/', $num)) return 'Mastercard';
	if (preg_match('/^(60|65|81|82|508)/', $num)) return 'RuPay';
	if (preg_match('/^3[47]/', $num)) return 'Amex';
	return 'Card';
}

/* ---------------- Payment capture + webhooks ---------------- */
// Mark a payment captured + its order paid, then notify the merchant's webhook.
function gw_capture($payment) {
	gw_db()->prepare("UPDATE gw_payments SET status='captured', updated_at=? WHERE id=?")
		->execute(array(gw_now(), $payment['id']));
	gw_db()->prepare("UPDATE gw_orders SET status='paid' WHERE id=?")
		->execute(array($payment['order_id']));
	$payment = gw_get_payment($payment['id']);
	gw_webhook($payment['merchant_key'], 'payment.captured', $payment);
	return $payment;
}

// POST a signed event to the merchant's webhook_url (best effort, logged).
function gw_webhook($merchantKey, $event, $payment) {
	$m = gw_merchant($merchantKey);
	$code = null;
	if ($m && !empty($m['webhook_url'])) {
		$payload = json_encode(array(
			'event' => $event,
			'payload' => array('payment' => array('entity' => gw_public_payment($payment))),
			'signature' => gw_sign($payment['order_id'], $payment['id'], $m['key_secret']),
			'created_at' => gw_now(),
		));
		$sig = hash_hmac('sha256', $payload, (string)$m['webhook_secret']);
		$ch = curl_init($m['webhook_url']);
		curl_setopt_array($ch, array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_POST           => true,
			CURLOPT_POSTFIELDS     => $payload,
			CURLOPT_TIMEOUT        => 8,
			CURLOPT_HTTPHEADER     => array('Content-Type: application/json', 'X-7Pay-Signature: ' . $sig),
		));
		curl_exec($ch);
		$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);
	}
	gw_db()->prepare('INSERT INTO gw_webhooks (merchant_key, payment_id, event, http_code, created_at) VALUES (?,?,?,?,?)')
		->execute(array($merchantKey, $payment['id'], $event, $code, gw_now()));
}

/* ---------------- Money formatting ---------------- */
function gw_currencies() { return array('INR' => '₹', 'USD' => '$', 'EUR' => '€', 'GBP' => '£', 'AED' => 'AED '); }

function gw_money($amountMinor, $currency) {
	$c = gw_currencies();
	$sym = isset($c[$currency]) ? $c[$currency] : $currency . ' ';
	$v = $amountMinor / 100;
	return $sym . (($v == (int)$v) ? number_format($v) : number_format($v, 2));
}

/**
 * Which currency this visitor pays in, from their country:
 * India → INR, UAE → AED, UK → GBP, eurozone → EUR, everywhere else → USD.
 * Session-cached; ?currency=XXX overrides (handy for testing and as a manual
 * switcher). Fails safe to INR (7By's primary audience) if geo is unavailable.
 */
function gw_geo_currency() {
	if (session_status() !== PHP_SESSION_ACTIVE) { session_name('sevenpay_geo'); session_start(); }
	$allowed = array_keys(gw_currencies());
	if (isset($_GET['currency'])) {
		$want = strtoupper(preg_replace('/[^a-zA-Z]/', '', $_GET['currency']));
		if (in_array($want, $allowed, true)) $_SESSION['gw_currency'] = $want;
	}
	if (!empty($_SESSION['gw_currency'])) return $_SESSION['gw_currency'];

	$cc = '';
	if (!empty($_SERVER['HTTP_CF_IPCOUNTRY'])) {
		$cc = strtoupper($_SERVER['HTTP_CF_IPCOUNTRY']); // Cloudflare, if present
	} else {
		$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
		if ($ip && !preg_match('/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1)/', $ip)) {
			$ctx = stream_context_create(array('http' => array('timeout' => 2)));
			$res = @file_get_contents('https://ipwho.is/' . urlencode($ip) . '?fields=country_code', false, $ctx);
			$j = $res ? json_decode($res, true) : null;
			if (!empty($j['country_code'])) $cc = strtoupper($j['country_code']);
		}
	}
	$map = array('IN' => 'INR', 'AE' => 'AED', 'GB' => 'GBP', 'US' => 'USD');
	$eurozone = array('DE','FR','IT','ES','NL','BE','AT','IE','PT','FI','GR','SK','SI','LV','LT','EE','LU','CY','MT','HR');
	if (isset($map[$cc]))                 $cur = $map[$cc];
	elseif (in_array($cc, $eurozone, true)) $cur = 'EUR';
	elseif ($cc !== '')                   $cur = 'USD';
	else                                  $cur = 'INR';
	$_SESSION['gw_currency'] = $cur;
	return $cur;
}
