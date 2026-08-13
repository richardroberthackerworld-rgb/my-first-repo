<?php
/**
 * 7By Account Hub — JSON API.
 * Called as: /api.php?action=<name>
 * Actions: me, signup, login, logout, google, order, verify, consume, webhook
 */
require __DIR__ . '/lib.php';
// Operational layer: incidents, email queue, lifecycle emails. Guarded so a
// part-finished deploy leaves the hub working rather than fataling.
if (is_file(__DIR__ . '/ops-events.php')) { require_once __DIR__ . '/ops-events.php'; }
api_guard();
cors();
boot_session();

$action = isset($_GET['action']) ? $_GET['action'] : '';
$in = body();
$GLOBALS['__RAW_IN'] = $in;   // lets current_user() find a {"token":...} in the body

switch ($action) {

	/* ---- public settings a tool needs to render its sign-in box ----
	        Just the Google client id (a PUBLIC value). Set it once here and
	        every tool shows the Google button — no per-tool config needed. ---- */
	case 'public_config': {
		global $CFG;
		$gid = $CFG['google']['client_id'] ?? '';
		if (strpos($gid, 'TODO') === 0) $gid = '';   // not filled in yet
		// Plans for the visitor's currency, formatted for the pricing modal.
		$P = hub_pricing();
		$plans = array();
		foreach (array_keys($P['plans']) as $k) {
			$d = plan_details($k);
			if ($d) $plans[$k] = array(
				'amount'  => $d['amount_minor'],   // minor units (paise/cents) — client shows amount/100
				'credits' => $d['credits'],
				'label'   => $d['label'],
				'days'    => $d['days'],
				'symbol'  => $d['symbol'],
			);
		}
		json_out(array('ok' => true, 'google_client_id' => $gid, 'plans' => $plans, 'gateway' => ($CFG['gateway'] ?? 'razorpay')));
		break;
	}

	/* ---- who am I (includes the tools this account has unlocked) ---- */
	case 'me': {
		$u = current_user();
		$pu = public_user($u);
		// A tool asks for ITS OWN balance (?tool=7q / 7solve). 7Marks and 7Solve
		// are separate products, so each reports its own credits and plan.
		$tool = tool_key((string)($_GET['tool'] ?? ($in['tool'] ?? '')));
		if ($u && $pu && $tool !== '') {
			$w = tool_wallet((int)$u['id'], $tool);
			$pu['credits'] = (int)$w['credits'];
			$pu['plan']    = (string)$w['plan'];
			$pu['expires'] = $w['plan_expires'];
			$pu['tool']    = $tool;
		}
		json_out(array('ok' => true, 'authed' => (bool)$u, 'user' => $pu,
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
		// Owner notification only. The member just completed an OTP round-trip,
		// so they know the account exists; a "welcome" with nothing actionable
		// in it would be marketing dressed as a transactional email.
		if (function_exists('ops_signup_hook')) {
			ops_signup_hook((int)$_SESSION['uid'], $email, $data['name']);
		}
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
		// Revoke ONLY the token that made this request, so signing out of one
		// tool leaves your other tools and devices signed in.
		revoke_api_token(api_token_from_request());
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
		// Where 7Pay sends the buyer back after a successful payment. Only allow
		// a return URL on one of our own tool origins (no open redirect).
		$ret = (string)($in['return'] ?? '');
		$origins = $CFG['allowed_origins'] ?? array();
		$retOk = '';
		foreach ($origins as $o) { if ($ret !== '' && strpos($ret, rtrim($o, '/')) === 0) { $retOk = $ret; break; } }
		$payload = array(
			'amount' => $d['amount_minor'], 'currency' => $d['currency'],
			'receipt' => 'u' . $u['id'] . '-' . time(),
			'notes' => array('user_id' => (string)$u['id'], 'plan' => $plan, 'product' => $product, 'credits' => (string)$d['credits']),
		);
		if ($gateway === 'sevenpay') {
			$payload['callback_url'] = $retOk;   // 7Pay redirects here on success (Razorpay's API rejects extra fields)
			list($code, $order) = sevenpay_api('order.create', $payload);
		} else {
			list($code, $order) = rzp_request('POST', '/orders', $payload);
		}
		if ($code >= 300 || empty($order['id'])) fail('Could not start payment. Please try again.', 502);
		// 'product' MUST be stored: grant_from_tx() reads it to credit the right
		// per-tool wallet (7Solve credits must never land in 7Marks, or in the
		// legacy global balance that no tool spends from).
		db()->prepare('INSERT INTO transactions (user_id, order_id, plan, amount, credits, currency, product, status) VALUES (?,?,?,?,?,?,?,?)')
			->execute(array($u['id'], $order['id'], $plan, $d['amount_minor'], $d['credits'], $d['currency'], $product, 'created'));
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
		// Receipt + owner copy. Only reachable past the signature check and the
		// already-paid guard above, so it cannot fire on an unverified claim or
		// on a replay. $tx still holds the pre-update row, so pass the payment
		// id that was just confirmed.
		if (function_exists('ops_purchase_hook')) {
			$tx['payment_id'] = $payId;
			$tx['status'] = 'paid';
			ops_purchase_hook($tx);
		}
		json_out(array('ok' => true, 'user' => public_user(current_user()),
			'tools' => user_tools($u['id'])));
		break;
	}

	/* ---- spend credits on an export (called by the tools) ---- */
	case 'consume': {
		$u = current_user();
		if (!$u) json_out(array('ok' => false, 'error' => 'not_authed'), 401);
		$count   = max(1, (int)($in['count'] ?? 1));
		$product = substr((string)($in['product'] ?? 'tool'), 0, 40);
		$tool    = tool_key($product);
		// Per-tool wallet: spending in 7Solve must never touch 7Marks credits.
		if ($tool !== '') {
			list($ok, $left) = tool_spend((int)$u['id'], $tool, $count);
			if (!$ok) json_out(array('ok' => false, 'error' => 'no_credits', 'credits' => $left, 'tool' => $tool), 402);
			db()->prepare('INSERT INTO usage_log (user_id, product, credits) VALUES (?,?,?)')->execute(array($u['id'], $product, $count));
			json_out(array('ok' => true, 'credits' => $left, 'tool' => $tool));
		}
		// No product named (legacy caller) — fall back to the shared balance.
		if ((int)$u['credits'] < $count) {
			json_out(array('ok' => false, 'error' => 'no_credits', 'credits' => (int)$u['credits']), 402);
		}
		db()->prepare('UPDATE users SET credits = credits - ? WHERE id = ?')->execute(array($count, $u['id']));
		db()->prepare('INSERT INTO usage_log (user_id, product, credits) VALUES (?,?,?)')->execute(array($u['id'], $product, $count));
		json_out(array('ok' => true, 'credits' => (int)$u['credits'] - $count));
		break;
	}

	/* ---- daily credit bonus (added for 7Marks Infinity: +20 a day) --------
	   ADDITIVE: a new action only. No existing case, query or response is
	   changed, so nothing 7Solve calls behaves differently.

	   Idempotency is the database's job, not this code's. The ledger row is
	   INSERTed first, and its UNIQUE (user_id, tool, bonus_key, grant_date)
	   is what rejects a second claim — so a double-tap, a retry, or two
	   devices claiming at the same instant cannot each be granted. Only if
	   that insert succeeds are credits added, and both happen in ONE
	   transaction, so there can never be a granted bonus with no record or a
	   record with no credits.

	   The date is UTC_DATE() from the SERVER, so a device with its clock
	   wound forward gets nothing. The amount comes from the table below,
	   never from the request body.                                          */
	case 'bonus': {
		global $CFG;
		$u = current_user();
		if (!$u) json_out(array('ok' => false, 'error' => 'not_authed'), 401);

		$product = substr((string)($in['product'] ?? ''), 0, 40);
		$tool    = tool_key($product);
		if ($tool === '') json_out(array('ok' => false, 'error' => 'no_tool'), 400);
		$bonusKey = preg_replace('/[^a-z0-9_]/', '', strtolower((string)($in['key'] ?? 'daily')));
		if ($bonusKey === '') $bonusKey = 'daily';

		/* Which plans earn a daily allowance, and how much. Server-side and
		   overridable from config; a plan that is not listed earns nothing. */
		$allow = $CFG['daily_bonus'] ?? array('7marks' => array('infinity' => 20));
		$wallet = tool_wallet((int)$u['id'], $tool);        // also creates the row
		$plan   = strtolower((string)($wallet['plan'] ?? 'none'));
		$amount = (int)($allow[$tool][$plan] ?? 0);

		if ($amount < 1) {
			json_out(array('ok' => false, 'error' => 'not_eligible',
			               'plan' => $plan, 'tool' => $tool,
			               'credits' => (int)$wallet['credits']), 403);
		}

		$pdo = db();
		try {
			$pdo->beginTransaction();

			/* The claim, and the guard. A duplicate key here means it was
			   already taken today — the wallet is then never touched. */
			$pdo->prepare(
				'INSERT INTO credit_bonus_log
				   (user_id, tool, bonus_key, grant_date, credits, plan_at_grant, created_at)
				 VALUES (?, ?, ?, UTC_DATE(), ?, ?, UTC_TIMESTAMP())'
			)->execute(array($u['id'], $tool, $bonusKey, $amount, $plan));

			$pdo->prepare(
				'UPDATE tool_credits SET credits = credits + ? WHERE user_id = ? AND tool = ?'
			)->execute(array($amount, $u['id'], $tool));

			$pdo->commit();
		} catch (Throwable $e) {
			if ($pdo->inTransaction()) $pdo->rollBack();
			/* 23000 is the integrity violation — i.e. already claimed today */
			if (strpos((string)$e->getCode(), '23000') === 0) {
				$w = tool_wallet((int)$u['id'], $tool);
				json_out(array('ok' => false, 'already_claimed' => true,
				               'credits' => (int)$w['credits'], 'tool' => $tool));
			}
			error_log('bonus failed: ' . $e->getMessage());
			json_out(array('ok' => false, 'error' => 'bonus_failed'), 500);
		}

		$after = tool_wallet((int)$u['id'], $tool);
		json_out(array('ok' => true, 'granted' => $amount,
		               'credits' => (int)$after['credits'], 'tool' => $tool));
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
					// Webhooks are retried by the provider, so this WILL run more
					// than once for the same payment. The dedupe key is the
					// payment id, so only the first delivery queues an email.
					if (function_exists('ops_purchase_hook')) {
						$tx['payment_id'] = $p['id'] ?? '';
						ops_purchase_hook($tx);
					}
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
				$pid = $evt['payload']['payment']['entity']['id'] ?? '';
				db()->prepare('UPDATE transactions SET status = "paid", payment_id = ? WHERE id = ?')
					->execute(array($pid, $tx['id']));
				grant_from_tx($tx);
				// Same as above: Razorpay retries webhooks, the payment id
				// dedupes, so a replay cannot send a second receipt.
				if (function_exists('ops_purchase_hook')) {
					$tx['payment_id'] = $pid;
					ops_purchase_hook($tx);
				}
			}
		}
		json_out(array('ok' => true));
		break;
	}

	default:
		fail('Unknown action.', 404);
}
