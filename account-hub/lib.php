<?php
/**
 * 7By Account Hub — shared helpers: DB, sessions, CORS, auth, credits, Razorpay, Google.
 */

$CFG = require __DIR__ . '/config.php';

/* Turn uncaught exceptions (bad DB config, etc.) into clean JSON instead of an
   HTML 500 page the frontend can't parse — which left buttons stuck on
   "Sending code…". Call from JSON endpoints (api.php). */
function api_guard() {
	set_exception_handler(function ($e) {
		error_log('[7by-hub] ' . get_class($e) . ': ' . $e->getMessage());
		$msg = ($e instanceof PDOException)
			? 'Database connection failed. Site owner: fill the "db" block in config.php (cPanel → MySQL Databases).'
			: 'Server error. Please try again.';
		http_response_code(500);
		header('Content-Type: application/json');
		echo json_encode(array('ok' => false, 'error' => $msg));
		exit;
	});
}

/* ---------------- Database (PDO) + auto-migrate ---------------- */
function db() {
	global $CFG;
	static $pdo = null;
	if ($pdo) return $pdo;
	$d = $CFG['db'];
	$pdo = new PDO(
		"mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4",
		$d['user'], $d['pass'],
		array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC)
	);
	$pdo->exec("CREATE TABLE IF NOT EXISTS users (
		id INT AUTO_INCREMENT PRIMARY KEY,
		name VARCHAR(120) NOT NULL DEFAULT '',
		email VARCHAR(190) NOT NULL UNIQUE,
		password_hash VARCHAR(255) NULL,
		google_id VARCHAR(64) NULL,
		credits INT NOT NULL DEFAULT 0,
		plan VARCHAR(20) NOT NULL DEFAULT 'none',
		plan_expires DATETIME NULL,
		api_token VARCHAR(64) NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	// existing installs: add the token column if it isn't there yet
	try { $pdo->exec("ALTER TABLE users ADD COLUMN api_token VARCHAR(64) NULL"); } catch (Exception $e) {}
	try { $pdo->exec("CREATE INDEX idx_users_api_token ON users (api_token)"); } catch (Exception $e) {}
	$pdo->exec("CREATE TABLE IF NOT EXISTS transactions (
		id INT AUTO_INCREMENT PRIMARY KEY,
		user_id INT NOT NULL,
		order_id VARCHAR(64) NULL,
		payment_id VARCHAR(64) NULL,
		plan VARCHAR(20) NULL,
		amount INT NULL,
		status VARCHAR(20) NOT NULL DEFAULT 'created',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	$pdo->exec("CREATE TABLE IF NOT EXISTS usage_log (
		id INT AUTO_INCREMENT PRIMARY KEY,
		user_id INT NOT NULL,
		product VARCHAR(40) NULL,
		credits INT NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	try { $pdo->exec("ALTER TABLE transactions ADD COLUMN credits INT NULL, ADD COLUMN currency VARCHAR(8) NULL"); } catch (Exception $e) { /* columns already exist */ }
	try { $pdo->exec("ALTER TABLE transactions ADD COLUMN tool VARCHAR(40) NULL"); } catch (Exception $e) { /* already exists */ }
	// Per-tool unlocks (entitlements). One row per (user, tool); NULL expiry = lifetime.
	$pdo->exec("CREATE TABLE IF NOT EXISTS entitlements (
		id INT AUTO_INCREMENT PRIMARY KEY,
		user_id INT NOT NULL,
		tool VARCHAR(40) NOT NULL,
		expires_at DATETIME NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE KEY uq_user_tool (user_id, tool)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	$pdo->exec("CREATE TABLE IF NOT EXISTS otps (
		id INT AUTO_INCREMENT PRIMARY KEY,
		email VARCHAR(190) NOT NULL,
		code VARCHAR(10) NOT NULL,
		purpose VARCHAR(20) NOT NULL,
		data TEXT NULL,
		expires_at DATETIME NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		INDEX idx_email_purpose (email, purpose)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	return $pdo;
}

/* ---------------- OTP + email ---------------- */
function gen_otp() { return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT); }

function mail_from() {
	global $CFG;
	if (!empty($CFG['mail_from'])) return $CFG['mail_from'];
	$host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/^www\./', '', $_SERVER['HTTP_HOST']) : '7by.in';
	return 'no-reply@' . $host;
}

/**
 * Minimal SMTP client (AUTH LOGIN) — sends through a real cPanel mailbox so
 * OTP emails actually arrive instead of being dropped/spam-binned like the
 * host's bare mail(). Returns true on a 250 after DATA, false otherwise.
 */
function smtp_send($to, $subject, $html) {
	global $CFG;
	$s = $CFG['smtp'];
	$from = mail_from();
	$remote = ($s['secure'] === 'ssl' ? 'ssl://' : 'tcp://') . $s['host'] . ':' . (int)$s['port'];
	$ctx = stream_context_create(array('ssl' => array('verify_peer' => false, 'verify_peer_name' => false)));
	$fp = @stream_socket_client($remote, $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
	if (!$fp) { error_log('[7by-hub] SMTP connect failed: ' . $errstr); return false; }
	stream_set_timeout($fp, 12);

	$read = function () use ($fp) {
		$out = '';
		while (($line = fgets($fp, 515)) !== false) {
			$out .= $line;
			if (strlen($line) < 4 || $line[3] !== '-') break; // last line of a multiline reply
		}
		return $out;
	};
	$say = function ($cmd, $expect) use ($fp, $read) {
		fwrite($fp, $cmd . "\r\n");
		$r = $read();
		if ((int)substr($r, 0, 3) !== $expect) { error_log('[7by-hub] SMTP "' . substr($cmd, 0, 12) . '…" got: ' . trim($r)); return false; }
		return true;
	};

	$hostname = isset($_SERVER['HTTP_HOST']) ? preg_replace('/[^a-zA-Z0-9.\-]/', '', $_SERVER['HTTP_HOST']) : 'localhost';
	if ((int)substr($read(), 0, 3) !== 220) { fclose($fp); return false; } // banner
	if (!$say('EHLO ' . $hostname, 250)) { fclose($fp); return false; }
	if ($s['secure'] === 'tls') {
		if (!$say('STARTTLS', 220)) { fclose($fp); return false; }
		if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) { fclose($fp); return false; }
		if (!$say('EHLO ' . $hostname, 250)) { fclose($fp); return false; }
	}
	if (!$say('AUTH LOGIN', 334) || !$say(base64_encode($s['user']), 334) || !$say(base64_encode($s['pass']), 235)) { fclose($fp); return false; }
	if (!$say('MAIL FROM:<' . $s['user'] . '>', 250)) { fclose($fp); return false; }
	if (!$say('RCPT TO:<' . $to . '>', 250)) { fclose($fp); return false; }
	if (!$say('DATA', 354)) { fclose($fp); return false; }

	$headers  = 'From: 7By <' . $from . ">\r\n";
	$headers .= 'Reply-To: ' . $from . "\r\n";
	$headers .= 'To: <' . $to . ">\r\n";
	$headers .= 'Subject: ' . preg_replace('/[\r\n]/', ' ', $subject) . "\r\n";
	$headers .= 'Date: ' . date('r') . "\r\n";
	$headers .= 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . preg_replace('/^.*@/', '', $from) . ">\r\n";
	$headers .= "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n";
	$body = preg_replace('/^\./m', '..', $html); // dot-stuffing
	$ok = $say($headers . "\r\n" . $body . "\r\n.", 250);
	fwrite($fp, "QUIT\r\n");
	fclose($fp);
	return $ok;
}

function send_email($to, $subject, $html) {
	global $CFG;
	// Prefer authenticated SMTP when configured; fall back to bare mail().
	if (!empty($CFG['smtp']['user']) && strpos($CFG['smtp']['user'], 'TODO') !== 0) {
		return smtp_send($to, $subject, $html);
	}
	$from = mail_from();
	$headers  = 'From: 7By <' . $from . ">\r\n";
	$headers .= 'Reply-To: ' . $from . "\r\n";
	$headers .= "MIME-Version: 1.0\r\n";
	$headers .= "Content-Type: text/html; charset=UTF-8\r\n";
	return @mail($to, $subject, $html, $headers);
}

/**
 * Branded, email-client-safe template (tables + inline styles so it renders
 * correctly in Gmail, Outlook, Apple Mail…). $blocks is the inner HTML.
 */
function email_template($heading, $blocks) {
	$year = date('Y');
	return '<!doctype html><html><body style="margin:0;padding:0;background-color:#F1F2FA">'
	. '<div style="display:none;max-height:0;overflow:hidden">' . htmlspecialchars($heading) . '</div>'
	. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F2FA;padding:32px 12px">'
	. '<tr><td align="center">'
	.   '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">'

	// Header band — brand gradient with solid fallback; real 7By logo in a
	// white rounded chip (hosted on the hub — email clients need absolute URLs)
	.   '<tr><td style="background-color:#4F46E5;background-image:linear-gradient(120deg,#4F46E5,#7C3AED);border-radius:16px 16px 0 0;padding:24px 36px" align="left">'
	.     '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
	.       '<td style="background-color:#ffffff;border-radius:12px;padding:9px 16px">'
	.         '<img src="https://account.7by.in/assets/logo-email.png" width="60" height="49" alt="7by" style="display:block;width:60px;height:auto;border:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#4F46E5;line-height:49px">'
	.       '</td>'
	.       '<td style="padding-left:14px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:-0.5px">7By<span style="font-weight:normal;color:rgba(255,255,255,0.75)">.in</span></td>'
	.     '</tr></table>'
	.   '</td></tr>'

	// Body card
	.   '<tr><td style="background-color:#ffffff;padding:36px;border-radius:0 0 16px 16px;font-family:Arial,Helvetica,sans-serif;color:#1E1E2E">'
	.     '<h1 style="margin:0 0 8px;font-size:22px;letter-spacing:-0.4px;color:#1E1E2E">' . $heading . '</h1>'
	.     $blocks
	.   '</td></tr>'

	// Footer
	.   '<tr><td style="padding:22px 12px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#9A9AB0">'
	.     'Sent by <a href="https://7by.in" style="color:#4F46E5;text-decoration:none">7By</a> — free AI tools'
	.     '<br>&copy; ' . $year . ' 7By.in &middot; This is an automated message, replies aren\'t monitored.'
	.   '</td></tr>'
	.   '</table>'
	. '</td></tr></table></body></html>';
}

/** The centred one-time-code block used by verification / reset emails. */
function email_code_block($code, $lead) {
	return '<p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#55556B">' . $lead . '</p>'
	. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
	.   '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
	.     '<td style="background-color:#F3F2FF;border:2px dashed #C7C4F4;border-radius:14px;padding:18px 40px;font-family:\'Courier New\',Courier,monospace;font-size:38px;font-weight:bold;letter-spacing:10px;color:#4F46E5">' . $code . '</td>'
	.   '</tr></table>'
	. '</td></tr></table>'
	. '<p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#8A8AA3;text-align:center">This code expires in <b style="color:#55556B">10 minutes</b>.</p>'
	. '<hr style="border:none;border-top:1px solid #ECECF4;margin:26px 0 18px">'
	. '<p style="margin:0;font-size:12.5px;line-height:1.7;color:#9A9AB0">'
	.   '&#128274; <b style="color:#55556B">Security tip:</b> 7By will never call, message or email you asking for this code. '
	.   'If you didn\'t request it, you can safely ignore this email &mdash; nothing changes on your account.'
	. '</p>';
}

// Create a fresh OTP for this email+purpose (replaces any previous one) and
// email it. Returns whether the email was actually accepted for delivery.
function issue_otp($email, $purpose, $data = null) {
	$code = gen_otp();
	db()->prepare('DELETE FROM otps WHERE email = ? AND purpose = ?')->execute(array($email, $purpose));
	db()->prepare('INSERT INTO otps (email, code, purpose, data, expires_at) VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))')
		->execute(array($email, $code, $purpose, $data ? json_encode($data) : null));
	if ($purpose === 'reset') {
		$title = 'Reset your 7By password';
		$lead  = 'We received a request to reset your 7By password. Enter this code on the reset page to continue:';
	} else {
		$title = 'Welcome to 7By — verify your email';
		$lead  = 'You\'re one step away from your account. Enter this code on the sign-up page to verify your email:';
	}
	$html = email_template($title, email_code_block($code, $lead));
	return (bool)send_email($email, $title . ' — code ' . $code, $html);
}

// Return the OTP row if a valid, unexpired code matches; else null.
function check_otp($email, $purpose, $code) {
	$st = db()->prepare('SELECT * FROM otps WHERE email = ? AND purpose = ? AND code = ? AND expires_at > NOW() ORDER BY id DESC LIMIT 1');
	$st->execute(array($email, $purpose, $code));
	return $st->fetch() ?: null;
}
function clear_otp($email, $purpose) {
	db()->prepare('DELETE FROM otps WHERE email = ? AND purpose = ?')->execute(array($email, $purpose));
}

/* ---------------- CORS + JSON ---------------- */
function cors() {
	global $CFG;
	$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
	if ($origin && in_array($origin, $CFG['allowed_origins'], true)) {
		header("Access-Control-Allow-Origin: $origin");
		header('Access-Control-Allow-Credentials: true');
		header('Vary: Origin');
	}
	header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
	header('Access-Control-Allow-Headers: Content-Type');
	if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
}

function json_out($data, $code = 200) {
	http_response_code($code);
	header('Content-Type: application/json');
	echo json_encode($data);
	exit;
}
function fail($msg, $code = 400) { json_out(array('ok' => false, 'error' => $msg), $code); }

function body() {
	$raw = file_get_contents('php://input');
	$j = json_decode($raw, true);
	return is_array($j) ? $j : $_POST;
}

/* ---------------- Sessions (shared across *.7by.in) ---------------- */
function boot_session() {
	global $CFG;
	if (session_status() === PHP_SESSION_ACTIVE) return;
	$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
	session_set_cookie_params(array(
		'lifetime' => 60 * 60 * 24 * 30,
		'path'     => '/',
		'domain'   => $CFG['cookie_domain'],
		'secure'   => $secure,
		'httponly' => true,
		// SameSite=None lets tool subdomains send the cookie on cross-site fetch.
		'samesite' => $secure ? 'None' : 'Lax',
	));
	session_name('sevenby_sess');
	session_start();
}

/* ---------------- Users + credits ---------------- */
function current_user() {
	// 1) Normal browser session (account.7by.in pages).
	if (!empty($_SESSION['uid'])) {
		$st = db()->prepare('SELECT * FROM users WHERE id = ?');
		$st->execute(array($_SESSION['uid']));
		$u = $st->fetch();
		if ($u) return refresh_plan($u);
	}
	// 2) API token — lets a TOOL's SERVER act for a signed-in user
	//    (a tool on another subdomain can't see our session cookie).
	$tok = api_token_from_request();
	if ($tok !== '') {
		$st = db()->prepare('SELECT * FROM users WHERE api_token = ?');
		$st->execute(array(hash('sha256', $tok)));
		$u = $st->fetch();
		if ($u) return refresh_plan($u);
	}
	return null;
}

// Bearer header, X-7By-Token, or ?token= / {"token":...}
function api_token_from_request() {
	$h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
	if (stripos($h, 'bearer ') === 0) return trim(substr($h, 7));
	if (!empty($_SERVER['HTTP_X_7BY_TOKEN'])) return trim($_SERVER['HTTP_X_7BY_TOKEN']);
	if (!empty($_GET['token'])) return trim((string)$_GET['token']);
	$raw = $GLOBALS['__RAW_IN'] ?? null;
	if (is_array($raw) && !empty($raw['token'])) return trim((string)$raw['token']);
	return '';
}

// Only allow sign-ups from configured email domains (e.g. gmail.com). Empty = any.
function email_domain_ok($email) {
	global $CFG;
	$allow = $CFG['allowed_email_domains'] ?? array();
	if (!$allow) return true;
	$dom = strtolower(substr(strrchr((string)$email, '@'), 1));
	foreach ($allow as $a) if (strcasecmp($dom, ltrim((string)$a, '@')) === 0) return true;
	return false;
}
function email_domain_msg() {
	global $CFG;
	$allow = $CFG['allowed_email_domains'] ?? array();
	return $allow
		? 'Please sign up with a ' . implode(' or ', array_map(function ($d) { return '@' . ltrim($d, '@'); }, $allow)) . ' email.'
		: 'Please use a valid email.';
}

// Issue (or reuse) a long-lived API token for this user. Only the HASH is stored.
function issue_api_token($userId) {
	$plain = bin2hex(random_bytes(24));
	db()->prepare('UPDATE users SET api_token = ? WHERE id = ?')
		->execute(array(hash('sha256', $plain), $userId));
	return $plain;
}

// Expire the plan (and its credits) once past plan_expires.
function refresh_plan($u) {
	if ($u['plan'] !== 'none' && $u['plan_expires'] && strtotime($u['plan_expires']) < time()) {
		db()->prepare("UPDATE users SET plan='none', plan_expires=NULL, credits=0 WHERE id=?")->execute(array($u['id']));
		$u['plan'] = 'none'; $u['plan_expires'] = null; $u['credits'] = 0;
	}
	return $u;
}

function public_user($u) {
	if (!$u) return null;
	return array(
		'name'    => $u['name'],
		'email'   => $u['email'],
		'plan'    => $u['plan'],
		'credits' => (int)$u['credits'],
		'expires' => $u['plan_expires'],
	);
}

function grant_plan($userId, $planKey, $credits = null, $days = null) {
	$plans = hub_pricing();
	$p = isset($plans['plans'][$planKey]) ? $plans['plans'][$planKey] : array('credits' => 0, 'days' => 30);
	if ($credits === null) $credits = $p['credits'];
	if ($days === null) $days = $p['days'];
	$expires = date('Y-m-d H:i:s', time() + $days * 86400);
	// Add credits (stack if they buy again) and set the new expiry.
	db()->prepare("UPDATE users SET credits = credits + ?, plan = ?, plan_expires = ? WHERE id = ?")
		->execute(array((int)$credits, $planKey, $expires, $userId));
}

/* ---------------- Per-tool unlocks (entitlements) ---------------- */
/**
 * Price + terms to unlock ONE tool, in the visitor's currency. Reads the
 * 'unlock' block from products.php. Returns null if the tool has no unlock.
 */
function tool_unlock_details($toolKey) {
	$prods = hub_products();
	if (empty($prods[$toolKey]['unlock'])) return null;
	$un  = $prods[$toolKey]['unlock'];
	$cur = user_currency();
	$prices = $un['prices'];
	$price = isset($prices[$cur]) ? $prices[$cur] : (isset($prices['USD']) ? $prices['USD'] : reset($prices));
	$P = hub_pricing();
	$sym = isset($P['currencies'][$cur]) ? $P['currencies'][$cur]['symbol'] : '';
	$days = isset($un['days']) ? (int)$un['days'] : 0;
	return array(
		'tool'    => $toolKey,
		'label'   => isset($un['label']) ? $un['label'] : ($prods[$toolKey]['brand'] ?? $toolKey),
		'days'    => $days,
		'currency'=> $cur, 'symbol' => $sym, 'price' => $price,
		'price_text'   => $sym . (($price == (int)$price) ? (string)(int)$price : rtrim(number_format($price, 2, '.', ''), '0')),
		'amount_minor' => (int)round($price * 100),
	);
}

/** Grant (or extend) a user's unlock for one tool. days<=0 => lifetime. */
function grant_tool($userId, $toolKey, $days = null) {
	$prods = hub_products();
	if ($days === null) $days = isset($prods[$toolKey]['unlock']['days']) ? (int)$prods[$toolKey]['unlock']['days'] : 0;
	if ($days <= 0) {
		db()->prepare("INSERT INTO entitlements (user_id, tool, expires_at) VALUES (?,?,NULL)
			ON DUPLICATE KEY UPDATE expires_at = NULL")->execute(array($userId, $toolKey));
		return;
	}
	// Re-buying extends from the later of now / current expiry (no lost days).
	$st = db()->prepare("SELECT expires_at FROM entitlements WHERE user_id=? AND tool=?");
	$st->execute(array($userId, $toolKey));
	$row = $st->fetch();
	$base = time();
	if ($row && $row['expires_at'] && strtotime($row['expires_at']) > $base) $base = strtotime($row['expires_at']);
	$expires = date('Y-m-d H:i:s', $base + $days * 86400);
	db()->prepare("INSERT INTO entitlements (user_id, tool, expires_at) VALUES (?,?,?)
		ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)")->execute(array($userId, $toolKey, $expires));
}

/** Does this user currently own (unlocked, unexpired) the given tool? */
function user_owns_tool($userId, $toolKey) {
	$st = db()->prepare("SELECT expires_at FROM entitlements WHERE user_id=? AND tool=?");
	$st->execute(array($userId, $toolKey));
	$row = $st->fetch();
	if (!$row) return array('owned' => false, 'expires' => null);
	if ($row['expires_at'] === null) return array('owned' => true, 'expires' => null); // lifetime
	$live = strtotime($row['expires_at']) >= time();
	return array('owned' => $live, 'expires' => $row['expires_at']);
}

/** Map of {tool => expiry} for every tool the user currently owns. */
function user_tools($userId) {
	$st = db()->prepare("SELECT tool, expires_at FROM entitlements WHERE user_id=? AND (expires_at IS NULL OR expires_at > NOW())");
	$st->execute(array($userId));
	$out = array();
	foreach ($st->fetchAll() as $r) $out[$r['tool']] = $r['expires_at'];
	return $out;
}

/** Grant whatever a paid transaction promised — a tool unlock or a credit plan. */
function grant_from_tx($tx) {
	if (!empty($tx['tool'])) grant_tool($tx['user_id'], $tx['tool']);
	else grant_plan($tx['user_id'], $tx['plan'], isset($tx['credits']) ? (int)$tx['credits'] : null);
}

/* ---------------- Pricing / currency / products ---------------- */
function hub_pricing()  { static $p = null; if ($p === null) $p = require __DIR__ . '/pricing.php';  return $p; }
function hub_products() { static $x = null; if ($x === null) $x = require __DIR__ . '/products.php'; return $x; }

/**
 * Which currency this visitor pays in. India -> INR, everywhere else -> USD.
 * Cached in the session; ?currency=USD|INR overrides (handy for testing).
 * Fails safe to INR if the geo lookup is unavailable.
 */
function user_currency() {
	$P = hub_pricing();
	$allowed = array_keys($P['currencies']);
	if (isset($_GET['currency'])) {
		$want = strtoupper(preg_replace('/[^a-zA-Z]/', '', $_GET['currency']));
		if (in_array($want, $allowed, true)) $_SESSION['currency'] = $want;
	}
	if (!empty($_SESSION['currency'])) return $_SESSION['currency'];

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
	$cur = ($cc === '' || $cc === 'IN') ? 'INR' : 'USD';
	$_SESSION['currency'] = $cur;
	return $cur;
}

/**
 * Everything needed to display + charge one plan, honouring the visitor's
 * currency and per-product credit overrides (e.g. VocalRemover 10 cr/song).
 */
function plan_details($planKey, $productKey = '') {
	$P = hub_pricing();
	if (!isset($P['plans'][$planKey])) return null;
	$plan = $P['plans'][$planKey];
	$credits = $plan['credits'];
	$note = '';
	$prods = hub_products();
	if ($productKey && isset($prods[$productKey])) {
		$pp = $prods[$productKey];
		if (!empty($pp['plan_credits'][$planKey])) $credits = (int)$pp['plan_credits'][$planKey];
		if (!empty($pp['plan_notes'][$planKey]))   $note = $pp['plan_notes'][$planKey];
	}
	$cur = user_currency();
	$c = $P['currencies'][$cur];
	$price = $c[$planKey];
	return array(
		'plan' => $planKey, 'label' => $plan['label'], 'days' => (int)$plan['days'],
		'credits' => (int)$credits, 'note' => $note,
		'currency' => $cur, 'symbol' => $c['symbol'], 'price' => $price,
		'price_text' => $c['symbol'] . (($price == (int)$price) ? (string)(int)$price : rtrim(number_format($price, 2, '.', ''), '0')),
		'amount_minor' => (int)round($price * 100), // paise / cents
	);
}

/* ---------------- Razorpay ---------------- */
function rzp_request($method, $path, $payload = null) {
	global $CFG;
	$r = $CFG['razorpay'];
	$ch = curl_init('https://api.razorpay.com/v1' . $path);
	curl_setopt_array($ch, array(
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_USERPWD        => $r['key_id'] . ':' . $r['key_secret'],
		CURLOPT_CUSTOMREQUEST  => $method,
		CURLOPT_HTTPHEADER     => array('Content-Type: application/json'),
	));
	if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
	$res = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);
	return array($code, json_decode($res, true));
}

function rzp_verify_signature($orderId, $paymentId, $signature) {
	global $CFG;
	$expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $CFG['razorpay']['key_secret']);
	return hash_equals($expected, (string)$signature);
}

/* ---------------- 7Pay (our own gateway, pay/ folder → pay.7by.in) ---------------- */
function sevenpay_api($action, $payload = null) {
	global $CFG;
	$s = $CFG['sevenpay'];
	$ch = curl_init($s['base_url'] . '/api.php?action=' . rawurlencode($action));
	curl_setopt_array($ch, array(
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_USERPWD        => $s['key_id'] . ':' . $s['key_secret'],
		CURLOPT_CUSTOMREQUEST  => $payload !== null ? 'POST' : 'GET',
		CURLOPT_HTTPHEADER     => array('Content-Type: application/json'),
		CURLOPT_TIMEOUT        => 10,
	));
	if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
	$res = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);
	return array($code, json_decode($res, true));
}

// Same HMAC scheme as Razorpay: sha256(order_id|payment_id, key_secret).
function sevenpay_verify_signature($orderId, $paymentId, $signature) {
	global $CFG;
	$expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $CFG['sevenpay']['key_secret']);
	return hash_equals($expected, (string)$signature);
}

/* ---------------- Google ID token verification ---------------- */
function google_verify($idToken) {
	global $CFG;
	$ch = curl_init('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken));
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	$res = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);
	if ($code !== 200) return null;
	$data = json_decode($res, true);
	if (!$data || empty($data['aud']) || $data['aud'] !== $CFG['google']['client_id']) return null;
	if (empty($data['email']) || (isset($data['email_verified']) && $data['email_verified'] === 'false')) return null;
	return $data; // sub, email, name, picture
}
