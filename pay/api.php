<?php
/**
 * 7Pay — JSON API. Called as: /api.php?action=<name>
 *
 * Merchant actions (HTTP Basic auth, key_id:key_secret):
 *   order.create   POST {amount (minor units), currency, receipt?, notes?, callback_url?}
 *   order.fetch    GET  ?id=order_xxx
 *   payment.fetch  GET  ?id=pay_xxx
 *   refund.create  POST {payment_id}
 *
 * Checkout actions (no auth — driven by the hosted checkout page):
 *   checkout.pay     POST — attempt a payment on an order
 *   checkout.status  GET  ?payment_id&key_id — poll a pending UPI payment
 */
require __DIR__ . '/lib.php';

// CORS: the API is server-to-server, but checkout.* runs same-origin and the
// account-hub may create orders cross-origin from PHP (no browser CORS needed).
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = isset($_GET['action']) ? $_GET['action'] : '';
$in = gw_body();

switch ($action) {

	/* ================= Merchant API ================= */

	case 'order.create': {
		$m = gw_require_merchant();
		$amount   = (int)($in['amount'] ?? 0);
		$currency = strtoupper(preg_replace('/[^A-Za-z]/', '', (string)($in['currency'] ?? 'INR')));
		if ($amount < 100) gw_fail('amount must be at least 100 (minor units, e.g. paise).');
		if (!array_key_exists($currency, gw_currencies())) gw_fail('currency must be one of: ' . implode(', ', array_keys(gw_currencies())) . '.');
		$order = gw_create_order($m, $amount, $currency,
			substr((string)($in['receipt'] ?? ''), 0, 120),
			isset($in['notes']) && is_array($in['notes']) ? $in['notes'] : null,
			substr((string)($in['callback_url'] ?? ''), 0, 500));
		gw_json(array('ok' => true) + gw_public_order($order));
		break;
	}

	case 'order.fetch': {
		$m = gw_require_merchant();
		$o = gw_get_order((string)($_GET['id'] ?? ''));
		if (!$o || $o['merchant_key'] !== $m['key_id']) gw_fail('Order not found.', 404);
		gw_json(array('ok' => true) + gw_public_order($o));
		break;
	}

	case 'payment.fetch': {
		$m = gw_require_merchant();
		$p = gw_get_payment((string)($_GET['id'] ?? ''));
		if (!$p || $p['merchant_key'] !== $m['key_id']) gw_fail('Payment not found.', 404);
		gw_json(array('ok' => true) + gw_public_payment($p));
		break;
	}

	/* Refunds are ledger-level: the payment is marked refunded and a webhook
	   fires. In live mode you still send the money back manually (UPI). */
	case 'refund.create': {
		$m = gw_require_merchant();
		$p = gw_get_payment((string)($in['payment_id'] ?? ''));
		if (!$p || $p['merchant_key'] !== $m['key_id']) gw_fail('Payment not found.', 404);
		if ($p['status'] !== 'captured') gw_fail('Only captured payments can be refunded.');
		gw_db()->prepare("UPDATE gw_payments SET status='refunded', updated_at=? WHERE id=?")
			->execute(array(gw_now(), $p['id']));
		$p = gw_get_payment($p['id']);
		gw_webhook($m['key_id'], 'payment.refunded', $p);
		gw_json(array('ok' => true) + gw_public_payment($p));
		break;
	}

	/* ================= Checkout (hosted page) ================= */

	case 'checkout.pay': {
		$keyId = (string)($in['key_id'] ?? '');
		$m = gw_merchant($keyId);
		$o = gw_get_order((string)($in['order_id'] ?? ''));
		if (!$m || !$o || $o['merchant_key'] !== $keyId) gw_fail('Order not found.', 404);
		if ($o['status'] === 'paid') gw_fail('This order is already paid.');

		$method  = (string)($in['method'] ?? '');
		$email   = substr(trim((string)($in['email'] ?? '')), 0, 190);
		$contact = substr(preg_replace('/[^0-9+ ]/', '', (string)($in['contact'] ?? '')), 0, 20);
		$isTest  = ($m['mode'] !== 'live');

		$payId = gw_id('pay_');
		$row = array(
			'id' => $payId, 'order_id' => $o['id'], 'merchant_key' => $keyId,
			'method' => $method, 'status' => 'created', 'amount' => (int)$o['amount'],
			'currency' => $o['currency'], 'email' => $email, 'contact' => $contact,
			'vpa' => null, 'utr' => null, 'bank' => null,
			'card_last4' => null, 'card_network' => null, 'error' => null,
			'created_at' => gw_now(), 'updated_at' => gw_now(),
		);

		$failWith = function ($msg) use (&$row) {
			$row['status'] = 'failed'; $row['error'] = $msg;
			gw_insert_payment($row);
			gw_json(array('ok' => false, 'error' => $msg, 'payment_id' => $row['id']), 400);
		};

		if ($method === 'card') {
			if (!$isTest) gw_fail('Card payments are available in test mode only.');
			$num = preg_replace('/\D/', '', (string)($in['card']['number'] ?? ''));
			$exp = (string)($in['card']['expiry'] ?? '');
			$cvv = (string)($in['card']['cvv'] ?? '');
			if (!gw_luhn_ok($num)) $failWith('Invalid card number.');
			if (!preg_match('/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/', $exp, $mm) || ((int)('20' . $mm[2]) * 100 + (int)$mm[1]) < ((int)date('Y') * 100 + (int)date('n')))
				$failWith('Card expiry is invalid or in the past.');
			if (!preg_match('/^\d{3,4}$/', $cvv)) $failWith('Invalid CVV.');
			// Test rule: any valid card succeeds, except numbers ending 0002 (declined).
			if (substr($num, -4) === '0002') $failWith('Card declined by issuing bank. Try another card.');
			$row['card_last4'] = substr($num, -4);
			$row['card_network'] = gw_card_network($num);
		}
		elseif ($method === 'upi' && $o['currency'] !== 'INR') {
			gw_fail('UPI supports INR only — use card or PayPal for international payments.');
		}
		elseif ($method === 'upi' && $isTest) {
			$vpa = trim((string)($in['vpa'] ?? ''));
			if (!preg_match('/^[\w.\-]{2,}@[a-zA-Z]{2,}$/', $vpa)) $failWith('Enter a valid UPI ID (e.g. name@upi).');
			if (preg_match('/fail/i', $vpa)) $failWith('UPI payment declined.'); // test rule
			$row['vpa'] = $vpa;
		}
		elseif ($method === 'upi') {
			// LIVE UPI collect: buyer already paid the configured VPA; record the
			// UTR and hold as "pending" until the merchant approves in the dashboard.
			global $GW;
			$utr = preg_replace('/\s/', '', (string)($in['utr'] ?? ''));
			if (!preg_match('/^[A-Za-z0-9]{6,30}$/', $utr)) $failWith('Enter the UTR / transaction reference from your UPI app.');
			$dup = gw_db()->prepare("SELECT id FROM gw_payments WHERE utr = ? AND status IN ('pending','captured')");
			$dup->execute(array($utr));
			if ($dup->fetch()) $failWith('This UTR has already been submitted.');
			$row['vpa'] = $GW['upi']['vpa']; $row['utr'] = $utr; $row['status'] = 'pending';
			gw_insert_payment($row);
			gw_webhook($keyId, 'payment.pending', $row);
			gw_json(array('ok' => true, 'status' => 'pending', 'payment_id' => $payId, 'order_id' => $o['id']));
		}
		elseif ($method === 'netbanking') {
			if (!$isTest) gw_fail('Netbanking is available in test mode only.');
			$bank = substr(trim((string)($in['bank'] ?? '')), 0, 60);
			if ($bank === '') $failWith('Please choose your bank.');
			$row['bank'] = $bank;
		}
		elseif ($method === 'paypal' && $isTest) {
			// Simulated PayPal — instant capture (any currency).
			$row['bank'] = 'PayPal';
		}
		elseif ($method === 'paypal') {
			// LIVE PayPal collect: buyer paid via the PayPal.me link; record the
			// Transaction ID and hold as "pending" until approved in the dashboard.
			$txn = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['txn'] ?? '')));
			if (strlen($txn) < 8 || strlen($txn) > 30) $failWith('Enter the Transaction ID from your PayPal receipt.');
			$dup = gw_db()->prepare("SELECT id FROM gw_payments WHERE utr = ? AND status IN ('pending','captured')");
			$dup->execute(array($txn));
			if ($dup->fetch()) $failWith('This Transaction ID has already been submitted.');
			$row['bank'] = 'PayPal'; $row['utr'] = $txn; $row['status'] = 'pending';
			gw_insert_payment($row);
			gw_webhook($keyId, 'payment.pending', $row);
			gw_json(array('ok' => true, 'status' => 'pending', 'payment_id' => $payId, 'order_id' => $o['id']));
		}
		else gw_fail('Unknown payment method.');

		// Success: capture + sign + webhook.
		$row['status'] = 'captured';
		gw_insert_payment($row);
		gw_db()->prepare("UPDATE gw_orders SET status='paid' WHERE id=?")->execute(array($o['id']));
		gw_webhook($keyId, 'payment.captured', $row);
		gw_json(array(
			'ok' => true, 'status' => 'captured',
			'sevenpay_order_id'   => $o['id'],
			'sevenpay_payment_id' => $payId,
			'sevenpay_signature'  => gw_sign($o['id'], $payId, $m['key_secret']),
		));
		break;
	}

	/* Poll a pending (live UPI) payment. Returns the signature once captured. */
	case 'checkout.status': {
		$keyId = (string)($_GET['key_id'] ?? '');
		$m = gw_merchant($keyId);
		$p = gw_get_payment((string)($_GET['payment_id'] ?? ''));
		if (!$m || !$p || $p['merchant_key'] !== $keyId) gw_fail('Payment not found.', 404);
		$out = array('ok' => true, 'status' => $p['status'], 'payment_id' => $p['id'], 'order_id' => $p['order_id']);
		if ($p['status'] === 'captured') {
			$out['sevenpay_order_id']   = $p['order_id'];
			$out['sevenpay_payment_id'] = $p['id'];
			$out['sevenpay_signature']  = gw_sign($p['order_id'], $p['id'], $m['key_secret']);
		}
		gw_json($out);
		break;
	}

	default:
		gw_fail('Unknown action.', 404);
}

/* Insert helper shared by the branches above. */
function gw_insert_payment($row) {
	gw_db()->prepare('INSERT INTO gw_payments
		(id, order_id, merchant_key, method, status, amount, currency, email, contact, vpa, utr, bank, card_last4, card_network, error, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
		->execute(array($row['id'], $row['order_id'], $row['merchant_key'], $row['method'], $row['status'],
			$row['amount'], $row['currency'], $row['email'], $row['contact'], $row['vpa'], $row['utr'],
			$row['bank'], $row['card_last4'], $row['card_network'], $row['error'], $row['created_at'], $row['updated_at']));
}
