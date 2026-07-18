<?php
/**
 * 7By Account Hub — JSON API.
 * Called as: /api.php?action=<name>
 * Actions: me, signup, login, logout, google, order, verify, consume, webhook
 */
require __DIR__ . '/lib.php';
api_guard();
cors();
boot_session();

$action = isset($_GET['action']) ? $_GET['action'] : '';
$in = body();
$GLOBALS['__RAW_IN'] = $in;   // lets current_user() find a {"token":...} in the body

switch ($action) {

	/* ---- who am I (includes the tools this account has unlocked) ---- */
	case 'me': {
		$u = current_user();
		json_out(array('ok' => true, 'authed' => (bool)$u, 'user' => public_user($u),
			'tools' => $u ? user_tools($u['id']) : array()));
		break;
	}

	/* ---- does the current user own a given tool? (tools call this) ---- */
	case 'access': {
		$u = current_user();
		$tool = preg_replace('/[^a-z0-9]/', '', strtolower((string)($_GET['tool'] ?? ($in['tool'] ?? ''))));
		if (!$u) json_out(array('ok' => true, 'authed' => false, 'owned' => false));
		$r = user_owns_tool($u['id'], $tool);
		json_out(array('ok' => true, 'authed' => true, 'owned' => $r['owned'], 'expires' => $r['expires']));
		break;
	}

	/* ---- signup step 1: validate + email an OTP (no account yet) ---- */
	case 'signup_start': {
		$name  = trim($in['name'] ?? '');
		$email = strtolower(trim($in['email'] ?? ''));
		$pass  = (string)($in['password'] ?? '');
		if ($name === '') fail('Please enter your name.');
		if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter a valid email.');
		if (!email_domain_ok($email)) fail(email_domain_msg());
		if (strlen($pass) < 6) fail('Password must be at least 6 characters.');
		$exists = db()->prepare('SELECT id FROM users WHERE email = ?');
		$exists->execute(array($email));
		if ($exists->fetch()) fail('An account with this email already exists. Please sign in.');
		$sent = issue_otp($email, 'signup', array('name' => $name, 'password_hash' => password_hash($pass, PASSWORD_DEFAULT)));
		if (!$sent) fail('Could not send the verification email. Site owner: configure the "smtp" block in config.php (see setup-check.php).', 502);
		json_out(array('ok' => true));
		break;
	}

	/* ---- signup step 2: verify OTP + create the account ---- */
	case 'signup_verify': {
		global $CFG;
		$email = strtolower(trim($in['email'] ?? ''));
		$code  = trim($in['code'] ?? '');
		$row = check_otp($email, 'signup', $code);
		if (!$row) fail('That code is wrong or has expired. Please try again.');
		$data = json_decode($row['data'], true);
		// Guard against a race where the email got registered meanwhile.
		$exists = db()->prepare('SELECT id FROM users WHERE email = ?');
		$exists->execute(array($email));
		if ($exists->fetch()) { clear_otp($email, 'signup'); fail('This email is already registered. Please sign in.'); }
		$st = db()->prepare('INSERT INTO users (name, email, password_hash, credits) VALUES (?,?,?,?)');
		$st->execute(array($data['name'], $email, $data['password_hash'], (int)$CFG['free_signup_credits']));
		clear_otp($email, 'signup');
		$_SESSION['uid'] = db()->lastInsertId();
		json_out(array('ok' => true, 'user' => public_user(current_user()), 'token' => issue_api_token($_SESSION['uid'])));
		break;
	}

	/* ---- forgot password step 1: email an OTP ---- */
	case 'reset_start': {
		$email = strtolower(trim($in['email'] ?? ''));
		$st = db()->prepare('SELECT id FROM users WHERE email = ?');
		$st->execute(array($email));
		// Only send if the account exists, but always reply ok (no email enumeration).
		if ($st->fetch()) issue_otp($email, 'reset');
		json_out(array('ok' => true));
		break;
	}

	/* ---- forgot password step 2: verify OTP + set new password ---- */
	case 'reset_verify': {
		$email = strtolower(trim($in['email'] ?? ''));
		$code  = trim($in['code'] ?? '');
		$pass  = (string)($in['password'] ?? '');
		if (strlen($pass) < 6) fail('Password must be at least 6 characters.');
		$row = check_otp($email, 'reset', $code);
		if (!$row) fail('That code is wrong or has expired. Please try again.');
		db()->prepare('UPDATE users SET password_hash = ? WHERE email = ?')
			->execute(array(password_hash($pass, PASSWORD_DEFAULT), $email));
		clear_otp($email, 'reset');
		json_out(array('ok' => true));
		break;
	}

	/* ---- email + password login ---- */
	case 'login': {
		$email = strtolower(trim($in['email'] ?? ''));
		$pass  = (string)($in['password'] ?? '');
		$st = db()->prepare('SELECT * FROM users WHERE email = ?');
		$st->execute(array($email));
		$u = $st->fetch();
		if (!$u || !$u['password_hash'] || !password_verify($pass, $u['password_hash'])) fail('Wrong email or password.', 401);
		$_SESSION['uid'] = $u['id'];
		json_out(array('ok' => true, 'user' => public_user(refresh_plan($u)), 'token' => issue_api_token($u['id'])));
		break;
	}

	/* ---- Google sign-in (receives a Google ID token) ---- */
	case 'google': {
		global $CFG;
		$token = (string)($in['credential'] ?? '');
		$g = google_verify($token);
		if (!$g) fail('Google sign-in failed. Please try again.', 401);
		$email = strtolower($g['email']);
		$st = db()->prepare('SELECT * FROM users WHERE email = ? OR google_id = ?');
		$st->execute(array($email, $g['sub']));
		$u = $st->fetch();
		if (!$u && !email_domain_ok($email)) fail(email_domain_msg());   // new Google users must match the domain rule
		if (!$u) {
			$ins = db()->prepare('INSERT INTO users (name, email, google_id, credits) VALUES (?,?,?,?)');
			$ins->execute(array($g['name'] ?? '', $email, $g['sub'], (int)$CFG['free_signup_credits']));
			$_SESSION['uid'] = db()->lastInsertId();
		} else {
			if (empty($u['google_id'])) db()->prepare('UPDATE users SET google_id = ? WHERE id = ?')->execute(array($g['sub'], $u['id']));
			$_SESSION['uid'] = $u['id'];
		}
		json_out(array('ok' => true, 'user' => public_user(current_user()), 'token' => issue_api_token($_SESSION['uid'])));
		break;
	}

	case 'logout':
		$_SESSION = array();
		session_destroy();
		json_out(array('ok' => true));
		break;

	/* ---- create a payment order for a plan (currency + credits are decided
	        server-side from the visitor's country and the product page).
	        Gateway is 7Pay (ours) or Razorpay per config 'gateway'. ---- */
	case 'order': {
		global $CFG;
		$u = current_user();
		if (!$u) fail('Please log in first.', 401);
		$plan = $in['plan'] ?? '';
		$product = preg_replace('/[^a-z0-9]/', '', strtolower((string)($in['product'] ?? '')));
		$d = plan_details($plan, $product);
		if (!$d) fail('Unknown plan.');
		$gateway = ($CFG['gateway'] ?? 'razorpay');
		$payload = array(
			'amount' => $d['amount_minor'], 'currency' => $d['currency'],
			'receipt' => 'u' . $u['id'] . '-' . time(),
			'notes' => array('user_id' => (string)$u['id'], 'plan' => $plan, 'product' => $product, 'credits' => (string)$d['credits']),
		);
		if ($gateway === 'sevenpay') {
			list($code, $order) = sevenpay_api('order.create', $payload);
		} else {
			list($code, $order) = rzp_request('POST', '/orders', $payload);
		}
		if ($code >= 300 || empty($order['id'])) fail('Could not start payment. Please try again.', 502);
		db()->prepare('INSERT INTO transactions (user_id, order_id, plan, amount, credits, currency, status) VALUES (?,?,?,?,?,?,?)')
			->execute(array($u['id'], $order['id'], $plan, $d['amount_minor'], $d['credits'], $d['currency'], 'created'));
		json_out(array('ok' => true, 'gateway' => $gateway, 'order_id' => $order['id'], 'amount' => $d['amount_minor'],
			'currency' => $d['currency'], 'credits' => $d['credits'],
			'key_id' => $gateway === 'sevenpay' ? $CFG['sevenpay']['key_id'] : $CFG['razorpay']['key_id'],
			'sevenpay_base' => $CFG['sevenpay']['base_url'] ?? '', 'plan' => $plan,
			'name' => $u['name'], 'email' => $u['email']));
		break;
	}

	/* ---- create a payment order to UNLOCK ONE TOOL (its own price). Grants
	        access to only that tool for this account. ---- */
	case 'tool_order': {
		global $CFG;
		$u = current_user();
		if (!$u) fail('Please log in first.', 401);
		$tool = preg_replace('/[^a-z0-9]/', '', strtolower((string)($in['tool'] ?? '')));
		$d = tool_unlock_details($tool);
		if (!$d) fail('Unknown tool.');
		$gateway = ($CFG['gateway'] ?? 'razorpay');
		$payload = array(
			'amount' => $d['amount_minor'], 'currency' => $d['currency'],
			'receipt' => 'u' . $u['id'] . '-' . $tool . '-' . time(),
			'notes' => array('user_id' => (string)$u['id'], 'tool' => $tool),
		);
		if ($gateway === 'sevenpay') {
			list($code, $order) = sevenpay_api('order.create', $payload);
		} else {
			list($code, $order) = rzp_request('POST', '/orders', $payload);
		}
		if ($code >= 300 || empty($order['id'])) fail('Could not start payment. Please try again.', 502);
		db()->prepare('INSERT INTO transactions (user_id, order_id, tool, amount, currency, status) VALUES (?,?,?,?,?,?)')
			->execute(array($u['id'], $order['id'], $tool, $d['amount_minor'], $d['currency'], 'created'));
		json_out(array('ok' => true, 'gateway' => $gateway, 'order_id' => $order['id'], 'amount' => $d['amount_minor'],
			'currency' => $d['currency'], 'tool' => $tool, 'label' => $d['label'],
			'key_id' => $gateway === 'sevenpay' ? $CFG['sevenpay']['key_id'] : $CFG['razorpay']['key_id'],
			'sevenpay_base' => $CFG['sevenpay']['base_url'] ?? '',
			'name' => $u['name'], 'email' => $u['email']));
		break;
	}

	/* ---- verify payment signature and grant credits (7Pay or Razorpay) ---- */
	case 'verify': {
		$u = current_user();
		if (!$u) fail('Please log in first.', 401);
		if (isset($in['sevenpay_order_id'])) {
			$orderId = $in['sevenpay_order_id'] ?? '';
			$payId   = $in['sevenpay_payment_id'] ?? '';
			$sig     = $in['sevenpay_signature'] ?? '';
			$okSig   = sevenpay_verify_signature($orderId, $payId, $sig);
		} else {
			$orderId = $in['razorpay_order_id'] ?? '';
			$payId   = $in['razorpay_payment_id'] ?? '';
			$sig     = $in['razorpay_signature'] ?? '';
			$okSig   = rzp_verify_signature($orderId, $payId, $sig);
		}
		$plan = $in['plan'] ?? '';
		if (!$okSig) fail('Payment could not be verified.', 400);
		// Make sure this order belongs to this user and isn't already paid.
		$st = db()->prepare('SELECT * FROM transactions WHERE order_id = ? AND user_id = ?');
		$st->execute(array($orderId, $u['id']));
		$tx = $st->fetch();
		if (!$tx) fail('Order not found.', 404);
		if ($tx['status'] === 'paid') json_out(array('ok' => true, 'user' => public_user(current_user())));
		db()->prepare('UPDATE transactions SET payment_id = ?, status = ? WHERE id = ?')
			->execute(array($payId, 'paid', $tx['id']));
		// Grant exactly what this order promised — a tool unlock or a credit plan.
		grant_from_tx($tx);
		json_out(array('ok' => true, 'user' => public_user(current_user()),
			'tools' => user_tools($u['id'])));
		break;
	}

	/* ---- spend credits on an export (called by the tools) ---- */
	case 'consume': {
		$u = current_user();
		if (!$u) json_out(array('ok' => false, 'error' => 'not_authed'), 401);
		$count = max(1, (int)($in['count'] ?? 1));
		$product = substr((string)($in['product'] ?? 'tool'), 0, 40);
		if ((int)$u['credits'] < $count) {
			json_out(array('ok' => false, 'error' => 'no_credits', 'credits' => (int)$u['credits']), 402);
		}
		db()->prepare('UPDATE users SET credits = credits - ? WHERE id = ?')->execute(array($count, $u['id']));
		db()->prepare('INSERT INTO usage_log (user_id, product, credits) VALUES (?,?,?)')->execute(array($u['id'], $product, $count));
		json_out(array('ok' => true, 'credits' => (int)$u['credits'] - $count));
		break;
	}

	/* ---- 7Pay webhook (fires on payment.captured — also confirms live-UPI
	        payments the merchant approves later in the 7Pay dashboard) ---- */
	case 'sevenpay_webhook': {
		global $CFG;
		$payload = file_get_contents('php://input');
		$sig = $_SERVER['HTTP_X_7PAY_SIGNATURE'] ?? '';
		$expected = hash_hmac('sha256', $payload, $CFG['sevenpay']['webhook_secret']);
		if (!hash_equals($expected, $sig)) fail('bad signature', 400);
		$evt = json_decode($payload, true);
		if (($evt['event'] ?? '') === 'payment.captured') {
			$p = $evt['payload']['payment']['entity'] ?? array();
			$oid = $p['order_id'] ?? '';
			// Double-check the payment signature too (belt and braces).
			if ($oid && sevenpay_verify_signature($oid, $p['id'] ?? '', $evt['signature'] ?? '')) {
				$st = db()->prepare('SELECT * FROM transactions WHERE order_id = ? AND status != "paid"');
				$st->execute(array($oid));
				$tx = $st->fetch();
				if ($tx) {
					db()->prepare('UPDATE transactions SET status = "paid", payment_id = ? WHERE id = ?')
						->execute(array($p['id'] ?? '', $tx['id']));
					grant_from_tx($tx);
				}
			}
		}
		json_out(array('ok' => true));
		break;
	}

	/* ---- Razorpay webhook (optional safety net) ---- */
	case 'webhook': {
		global $CFG;
		$payload = file_get_contents('php://input');
		$sig = $_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '';
		$expected = hash_hmac('sha256', $payload, $CFG['razorpay']['webhook_secret']);
		if (!hash_equals($expected, $sig)) fail('bad signature', 400);
		$evt = json_decode($payload, true);
		if (($evt['event'] ?? '') === 'payment.captured') {
			$oid = $evt['payload']['payment']['entity']['order_id'] ?? '';
			$st = db()->prepare('SELECT * FROM transactions WHERE order_id = ? AND status != "paid"');
			$st->execute(array($oid));
			$tx = $st->fetch();
			if ($tx) {
				db()->prepare('UPDATE transactions SET status = "paid", payment_id = ? WHERE id = ?')
					->execute(array($evt['payload']['payment']['entity']['id'] ?? '', $tx['id']));
				grant_from_tx($tx);
			}
		}
		json_out(array('ok' => true));
		break;
	}

	default:
		fail('Unknown action.', 404);
}
