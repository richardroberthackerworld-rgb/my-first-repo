<?php
/**
 * 7By Account Hub — setup diagnostics.
 * Open https://account.7by.in/setup-check.php after deploying to see exactly
 * which config values still need attention. Shows statuses only, never secrets.
 * You can delete this file once everything is green.
 */
$CFG = require __DIR__ . '/config.php';

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
<p>Fix anything with a ❌, then reload this page. Delete this file when all green.</p><table>';

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
row('Email (OTP codes)', function_exists('mail') ? true : false, function_exists('mail')
	? 'PHP mail() is available. OTPs send from ' . (isset($CFG['mail_from']) && $CFG['mail_from'] ? $CFG['mail_from'] : 'no-reply@' . (isset($_SERVER['HTTP_HOST']) ? preg_replace('/^www\./', '', $_SERVER['HTTP_HOST']) : '7by.in')) . '. If codes don\'t arrive, check the spam folder first.'
	: 'mail() is disabled on this host — ask your hosting provider.');

/* Google */
row('Google Sign-In', is_todo($CFG['google']['client_id']) ? 'warn' : true, is_todo($CFG['google']['client_id'])
	? 'Not configured — the Google button is hidden and email login is used. Optional: create an OAuth "Web application" client at console.cloud.google.com with JS origin https://account.7by.in and paste the Client ID into config.php.'
	: 'Client ID set: ' . substr($CFG['google']['client_id'], 0, 12) . '…  If Google still says invalid_client, the ID has a typo or belongs to a deleted client.');

/* Payment gateway */
$gw = isset($CFG['gateway']) ? $CFG['gateway'] : 'razorpay';
if ($gw === 'sevenpay') {
	$sp = isset($CFG['sevenpay']) ? $CFG['sevenpay'] : array();
	$spOk = !empty($sp['key_id']) && !is_todo($sp['key_id']) && !empty($sp['key_secret']) && !is_todo($sp['key_secret']);
	row('Payments (7Pay)', $spOk ? true : 'warn', $spOk ? 'Configured, using ' . (isset($sp['base_url']) ? $sp['base_url'] : '?') : 'gateway is "sevenpay" but key_id/key_secret still have TODOs — payments will fail until filled. Not needed for login/OTP.');
} else {
	$rzOk = !is_todo($CFG['razorpay']['key_id']);
	row('Payments (Razorpay)', $rzOk ? true : 'warn', $rzOk ? 'Key configured.' : 'Razorpay keys still TODO — payments will fail until filled. Not needed for login/OTP.');
}

/* Cookie domain */
$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
$cd = $CFG['cookie_domain'];
row('Cookie domain', ($host === '' || substr($host, -strlen(trim($cd, '.'))) === trim($cd, '.')) ? true : 'warn',
	'cookie_domain is "' . $cd . '"' . ($host ? ' and this page is served from "' . $host . '"' : '') . '. They must match (login is shared across *.7by.in).');

echo '</table><p class="foot">7By Account Hub · setup-check.php · shows configuration status only, never secret values.</p></body></html>';
