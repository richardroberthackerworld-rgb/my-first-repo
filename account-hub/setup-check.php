<?php
/**
 * 7By Account Hub — setup diagnostics.
 * Open https://account.7by.in/setup-check.php after deploying to see exactly
 * which config values still need attention. Shows statuses only, never secrets.
 * You can delete this file once everything is green.
 */
require __DIR__ . '/lib.php'; // defines send_email/smtp_send and loads $CFG

function row($name, $ok, $detail) {
	$icon = $ok === true ? '✅' : ($ok === 'warn' ? '⚠️' : '❌');
	echo '<tr><td>' . $icon . '</td><td><b>' . htmlspecialchars($name) . '</b></td><td>' . htmlspecialchars($detail) . '</td></tr>';
}
function is_todo($v) { return is_string($v) && strpos($v, 'TODO') === 0; }

header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html><head><meta charset="utf-8"><title>7By Hub — setup check</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1a1a2e}
table{border-collapse:collapse;width:100%}td{padding:10px 12px;border-bottom:1px solid #eee;font-size:15px;vertical-align:top}
h1{font-size:26px}p{color:#555}.foot{margin-top:24px;font-size:13px;color:#888}</style>
</head><body><h1>7By Account Hub — setup check</h1>
<p>Fix anything with a ❌, then reload this page. Delete this file when all green.</p>';

/* One-click email delivery test: /setup-check.php?testmail=you@example.com */
if (!empty($_GET['testmail']) && filter_var($_GET['testmail'], FILTER_VALIDATE_EMAIL)) {
	$t = $_GET['testmail'];
	$ok = send_email($t, '7By test email', email_template('Email delivery works 🎉',
		'<p style="margin:0;font-size:15px;line-height:1.65;color:#55556B">If you can read this, email sending on <b>account.7by.in</b> is configured correctly. OTP codes will arrive just like this message did.</p>'));
	echo '<p style="padding:12px 16px;border-radius:8px;background:' . ($ok ? '#e7f8ef' : '#fdeaea') . '">'
		. ($ok ? '✅ Test email accepted for delivery to <b>' : '❌ Sending failed to <b>') . htmlspecialchars($t)
		. '</b>.' . ($ok ? ' Check the inbox (and spam folder).' : ' Check the smtp block in config.php — host/port/user/password.') . '</p>';
}

echo '<table>';

/* PHP */
row('PHP version', version_compare(PHP_VERSION, '7.4', '>='), 'PHP ' . PHP_VERSION . (version_compare(PHP_VERSION, '7.4', '>=') ? ' — fine' : ' — too old, pick PHP 8.x in cPanel MultiPHP Manager'));

/* Database */
if (is_todo($CFG['db']['name']) || is_todo($CFG['db']['user']) || is_todo($CFG['db']['pass'])) {
	row('Database', false, 'config.php still has TODO placeholders in the "db" block. Create a DB + user in cPanel → MySQL Databases, grant All Privileges, and fill host/name/user/pass.');
} else {
	try {
		$pdo = new PDO(
			"mysql:host={$CFG['db']['host']};dbname={$CFG['db']['name']};charset=utf8mb4",
			$CFG['db']['user'], $CFG['db']['pass'],
			array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION)
		);
		$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
		row('Database connection', true, 'Connected to "' . $CFG['db']['name'] . '" as "' . $CFG['db']['user'] . '". Tables present: ' . ($tables ? implode(', ', $tables) : 'none yet — they auto-create on first signup'));
	} catch (Exception $e) {
		row('Database connection', false, 'Connection failed: ' . $e->getMessage() . ' — check name/user/password in config.php and that the user is added to the database with All Privileges.');
	}
}

/* App secret */
row('app_secret', !is_todo($CFG['app_secret']), is_todo($CFG['app_secret'])
	? 'Still the TODO placeholder. Replace with a long random string (any 40+ random characters).'
	: 'Set.');

/* Email */
$smtpConfigured = !empty($CFG['smtp']['user']) && !is_todo($CFG['smtp']['user']);
if ($smtpConfigured) {
	row('Email (OTP codes)', true, 'SMTP configured: ' . $CFG['smtp']['user'] . ' via ' . $CFG['smtp']['host'] . ':' . $CFG['smtp']['port'] . '. Use the test form below to confirm delivery.');
} else {
	row('Email (OTP codes)', 'warn', 'Using bare PHP mail() — often dropped or spam-binned. Recommended: cPanel → Email Accounts → create no-reply@7by.in, then fill the "smtp" block in config.php.');
}

/* Google */
row('Google Sign-In', is_todo($CFG['google']['client_id']) ? 'warn' : true, is_todo($CFG['google']['client_id'])
	? 'Not configured — the Google button is hidden and email login is used. Optional: create an OAuth "Web application" client at console.cloud.google.com with JS origin https://account.7by.in and paste the Client ID into config.php.'
	: 'Client ID set: ' . substr($CFG['google']['client_id'], 0, 12) . '…  If Google still says invalid_client, the ID has a typo or belongs to a deleted client.');

/* Payment gateway */
$gw = isset($CFG['gateway']) ? $CFG['gateway'] : 'razorpay';
if ($gw === 'sevenpay') {
	$sp = isset($CFG['sevenpay']) ? $CFG['sevenpay'] : array();
	$spOk = !empty($sp['key_id']) && !is_todo($sp['key_id']) && !empty($sp['key_secret']) && !is_todo($sp['key_secret']);
	if (!$spOk) {
		row('Payments (7Pay)', 'warn', 'gateway is "sevenpay" but key_id/key_secret still have TODOs — payments will fail until filled. Not needed for login/OTP.');
	} else {
		// Live connectivity + auth test against the gateway (a 404 on a fake
		// lookup proves the URL is right AND the credentials are accepted).
		$base = rtrim((string)($sp['base_url'] ?? ''), '/');
		$ch = curl_init($base . '/api.php?action=payment.fetch&id=ping_setup_check');
		curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_USERPWD => $sp['key_id'] . ':' . $sp['key_secret'], CURLOPT_TIMEOUT => 8));
		curl_exec($ch);
		$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		$cerr = curl_error($ch);
		curl_close($ch);
		if ($code === 404)      row('Payments (7Pay)', true, 'Connected to ' . $base . ' and authenticated — orders will work.');
		elseif ($code === 401)  row('Payments (7Pay)', false, $base . ' is reachable but rejected the credentials — key_id/key_secret here do NOT match the merchant in the gateway\'s config.php.');
		elseif ($code === 0)    row('Payments (7Pay)', false, 'Could not connect to ' . $base . ' (' . ($cerr ?: 'no response') . ') — check base_url (is it https://7pay.7by.in?).');
		else                    row('Payments (7Pay)', false, $base . ' answered HTTP ' . $code . ' — unexpected; check base_url points at the 7Pay folder.');
	}
} else {
	$rzOk = !is_todo($CFG['razorpay']['key_id']);
	row('Payments (Razorpay)', $rzOk ? true : 'warn', $rzOk ? 'Key configured.' : 'Razorpay keys still TODO — payments will fail until filled. Not needed for login/OTP.');
}

/* Cookie domain */
$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
$cd = $CFG['cookie_domain'];
row('Cookie domain', ($host === '' || substr($host, -strlen(trim($cd, '.'))) === trim($cd, '.')) ? true : 'warn',
	'cookie_domain is "' . $cd . '"' . ($host ? ' and this page is served from "' . $host . '"' : '') . '. They must match (login is shared across *.7by.in).');

echo '</table>
<form method="get" style="margin-top:22px;display:flex;gap:8px">
	<input name="testmail" type="email" required placeholder="you@example.com" style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px">
	<button style="padding:10px 18px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-size:15px;cursor:pointer">Send test email</button>
</form>
<p class="foot">7By Account Hub · setup-check.php · shows configuration status only, never secret values. Delete this file when done.</p></body></html>';
