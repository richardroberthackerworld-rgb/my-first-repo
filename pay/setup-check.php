<?php
/**
 * 7Pay — setup diagnostics.
 * Open https://pay.7by.in/setup-check.php after deploying to see exactly what
 * still needs attention. Shows statuses only, never secrets.
 * Delete this file once everything is green.
 */
$GW = require __DIR__ . '/config.php';

function row($name, $ok, $detail) {
	$icon = $ok === true ? '✅' : ($ok === 'warn' ? '⚠️' : '❌');
	echo '<tr><td>' . $icon . '</td><td><b>' . htmlspecialchars($name) . '</b></td><td>' . htmlspecialchars($detail) . '</td></tr>';
}
function is_todo($v) { return is_string($v) && strpos($v, 'TODO') === 0; }

header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html><head><meta charset="utf-8"><title>7Pay — setup check</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 16px;color:#1a1a2e}
table{border-collapse:collapse;width:100%}td{padding:10px 12px;border-bottom:1px solid #eee;font-size:15px;vertical-align:top}
h1{font-size:26px}p{color:#555}.foot{margin-top:24px;font-size:13px;color:#888}</style>
</head><body><h1>7Pay — setup check</h1>
<p>Fix anything with a ❌, then reload. ⚠️ items are optional or only matter for live mode. Delete this file when done.</p><table>';

/* PHP */
row('PHP version', version_compare(PHP_VERSION, '7.4', '>='), 'PHP ' . PHP_VERSION . (version_compare(PHP_VERSION, '7.4', '>=') ? ' — fine' : ' — too old, pick PHP 8.x in cPanel MultiPHP Manager'));

/* Database */
if ($GW['db']['driver'] === 'sqlite') {
	if (!extension_loaded('pdo_sqlite')) {
		row('Database (SQLite)', false, 'pdo_sqlite extension missing — enable it in cPanel → Select PHP Version → Extensions, or switch db.driver to mysql.');
	} else {
		$dir = dirname($GW['db']['sqlite_path']);
		if (!is_dir($dir)) @mkdir($dir, 0755, true);
		$writable = is_dir($dir) && is_writable($dir);
		row('Database (SQLite)', $writable, $writable
			? 'data/ folder is writable — tables auto-create on first use.'
			: 'data/ folder is not writable. In cPanel File Manager create "data" inside the pay folder and set permissions to 755 (or 775).');
		$ht = is_file($dir . '/../.htaccess') || is_file(__DIR__ . '/.htaccess');
		row('DB protected from the web', $ht ? true : 'warn', $ht
			? '.htaccess present (blocks direct downloads of the database file).'
			: 'No .htaccess found — make sure the zip\'s .htaccess was extracted so the data/ folder is not downloadable.');
	}
} else {
	try {
		new PDO("mysql:host={$GW['db']['host']};dbname={$GW['db']['name']};charset=utf8mb4", $GW['db']['user'], $GW['db']['pass'], array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION));
		row('Database (MySQL)', true, 'Connected to "' . $GW['db']['name'] . '".');
	} catch (Exception $e) {
		row('Database (MySQL)', false, 'Connection failed: ' . $e->getMessage());
	}
}

/* app secret */
row('app_secret', !is_todo($GW['app_secret']), is_todo($GW['app_secret'])
	? 'Still the TODO placeholder — replace with any long random string (signs dashboard sessions).'
	: 'Set.');

/* Live payment rails */
row('UPI VPA (live INR payments)', is_todo($GW['upi']['vpa']) ? 'warn' : true, is_todo($GW['upi']['vpa'])
	? 'Still TODO — required before switching any merchant to live. Put your real UPI ID (e.g. name@okhdfcbank); buyers pay it directly via QR / GPay / PhonePe.'
	: 'Set: ' . $GW['upi']['vpa'] . ' — double-check this is EXACTLY your UPI ID; money goes straight there.');
/* Automatic UPI detection */
$ua = isset($GW['upi_auto']) ? $GW['upi_auto'] : array();
$uaOn = !empty($ua['enabled']) && !empty($ua['token']) && !is_todo($ua['token']);
$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '7pay.7by.in';
row('Auto UPI detection (no UTR / no manual approve)', $uaOn ? true : 'warn', $uaOn
	? 'Enabled. Point your phone\'s SMS-forwarder app at: https://' . $host . '/api.php?action=upi.credit&token=<your token from config.php>. Bank credit SMS → payment auto-captures.'
	: 'Off (token still TODO). Buyers must enter the UTR and you approve in the dashboard. To automate: set a long random token in the upi_auto block, then install an SMS-forwarder app on your phone (see SETUP.md).');

$ppTodo = strpos($GW['paypal']['me_link'], 'TODO') !== false;
row('PayPal.me (live international)', $ppTodo ? 'warn' : true, $ppTodo
	? 'Still TODO — only needed if you want USD/EUR/GBP buyers in live mode.'
	: 'Set: ' . $GW['paypal']['me_link']);

/* Merchants */
foreach ($GW['merchants'] as $keyId => $m) {
	$issues = array();
	if (is_todo($m['key_secret'])) $issues[] = 'key_secret is TODO';
	if (!empty($m['webhook_url']) && is_todo($m['webhook_secret'])) $issues[] = 'webhook_secret is TODO';
	$label = 'Merchant ' . $keyId . ' (' . $m['mode'] . ' mode)';
	if ($keyId === '7pay_demo') {
		row($label, $m['mode'] === 'test' ? true : 'warn', $m['mode'] === 'test' ? 'Demo store — fine as is; delete this merchant + demo.php in production if you like.' : 'Demo merchant should stay in test mode.');
		continue;
	}
	if ($issues) {
		row($label, false, implode('; ', $issues) . '. These must match the "sevenpay" block in account-hub/config.php.');
	} else {
		// Webhook reachability (any HTTP answer below 500 proves the URL resolves)
		$detail = 'Secrets set.';
		if (!empty($m['webhook_url'])) {
			$ch = curl_init($m['webhook_url']);
			curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_POSTFIELDS => '{}', CURLOPT_TIMEOUT => 6));
			curl_exec($ch);
			$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
			curl_close($ch);
			$detail .= $code && $code < 500
				? ' Webhook URL reachable (HTTP ' . $code . ' — a 400 here is normal, it means the hub rejected our unsigned ping).'
				: ' Webhook URL did NOT respond (' . ($code ?: 'no connection') . ') — check the URL.';
		} else {
			$detail .= ' No webhook_url set — dashboard approvals won\'t notify the hub automatically.';
		}
		row($label, strpos($detail, 'NOT') === false ? true : false, $detail . ($m['mode'] === 'live' ? ' LIVE — real payments enabled.' : ' Still in test mode — flip to "live" for real payments.'));
	}
}

echo '</table><p class="foot">7Pay · setup-check.php · shows configuration status only, never secret values.</p></body></html>';
