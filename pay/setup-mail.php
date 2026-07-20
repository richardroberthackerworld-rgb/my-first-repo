<?php
/**
 * 7Pay — ONE-TIME setup page for the email poller (phone-free UPI auto-detect).
 *
 * Upload this file next to config.php, then open it in your browser:
 *     https://pay.7by.in/setup-mail.php
 * Type the alert mailbox's password, click Save — it patches config.php IN
 * PLACE (all your existing secrets/values are kept, a backup copy is written
 * alongside) and then DELETES ITSELF.
 *
 * If you abandon setup, delete this file from the server yourself.
 */

error_reporting(E_ALL & ~E_DEPRECATED);
$cfgFile = __DIR__ . '/config.php';
$GW = require $cfgFile;

/* already configured? then this page must not exist any more */
$m = isset($GW['upi_mail']) ? $GW['upi_mail'] : array();
if (!empty($m['enabled']) && !empty($m['pass']) && strpos((string)$m['pass'], 'TODO') !== 0) {
	die('Email poller is already configured. Delete setup-mail.php from the server.');
}

$err = ''; $done = false; $cron = ''; $imapNote = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$user = trim((string)($_POST['user'] ?? ''));
	$pass = (string)($_POST['pass'] ?? '');
	$host = trim((string)($_POST['host'] ?? '')) ?: 'localhost';

	if ($user === '' || strpos($user, '@') === false) $err = 'Enter the full mailbox address, e.g. upi-alerts@7by.in';
	elseif ($pass === '') $err = 'Enter the mailbox password.';

	/* try the mailbox before saving, so wrong details never get written */
	if ($err === '') {
		if (function_exists('imap_open')) {
			$mb = @imap_open('{' . $host . ':993/imap/ssl/novalidate-cert}INBOX', $user, $pass);
			if (!$mb && $host === 'localhost') { // some cPanels want the mail.domain host
				$alt = 'mail.' . substr($user, strpos($user, '@') + 1);
				$mb = @imap_open('{' . $alt . ':993/imap/ssl/novalidate-cert}INBOX', $user, $pass);
				if ($mb) $host = $alt;
			}
			if ($mb) { imap_close($mb); $imapNote = 'Mailbox login: OK (' . htmlspecialchars($host) . ')'; }
			else $err = 'Could not log in to the mailbox: ' . htmlspecialchars((string)imap_last_error())
				. ' — create the email account in cPanel first, and check the password.';
		} else {
			$imapNote = 'NOTE: PHP "imap" extension is missing — enable it in cPanel → Select PHP Version → Extensions → imap, or the poller cannot run.';
		}
	}

	if ($err === '') {
		/* patch the config array — everything already set is kept as-is */
		if (!isset($GW['upi_auto']) || !is_array($GW['upi_auto'])) $GW['upi_auto'] = array();
		$GW['upi_auto']['enabled'] = true;
		$tok = (string)($GW['upi_auto']['token'] ?? '');
		if ($tok === '' || strpos($tok, 'TODO') === 0) $GW['upi_auto']['token'] = bin2hex(random_bytes(24));
		if (!isset($GW['upi_auto']['window_minutes'])) $GW['upi_auto']['window_minutes'] = 45;

		$self = 'https://' . (string)($_SERVER['HTTP_HOST'] ?? 'pay.7by.in');
		$GW['upi_mail'] = array(
			'enabled'         => true,
			'host'            => $host,
			'port'            => 993,
			'ssl'             => true,
			'user'            => $user,
			'pass'            => $pass,
			'allowed_senders' => array('phonepe'),   // add your bank's sender here later if you enable bank e-mails
			'max_age_hours'   => 24,
			'self_url'        => $self,
		);

		/* backup, then write the new config atomically and verify it parses */
		@copy($cfgFile, __DIR__ . '/config.backup-' . date('Ymd-His') . '.php');
		$out = "<?php\n/* 7Pay configuration — rewritten by setup-mail.php on " . date('Y-m-d H:i')
			. " (a config.backup-*.php copy of the previous file is alongside). */\nreturn "
			. var_export($GW, true) . ";\n";
		$tmp = $cfgFile . '.new';
		if (@file_put_contents($tmp, $out) === false) $err = 'Could not write config (file permissions?).';
		else {
			$check = @include $tmp;
			if (!is_array($check) || empty($check['upi_mail']['enabled'])) { @unlink($tmp); $err = 'Rewritten config failed verification — nothing was changed.'; }
			elseif (!@rename($tmp, $cfgFile)) { @unlink($tmp); $err = 'Could not replace config.php (file permissions?).'; }
			else {
				$done = true;
				$cron = 'php -q ' . __DIR__ . '/mail-poller.php';
				@unlink(__FILE__);   // job done — remove this setup page from the server
			}
		}
	}
}
?><!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>7Pay — email poller setup</title>
<link rel="icon" type="image/png" href="favicon.png">
<style>
	body{font-family:system-ui,sans-serif;background:#f6f1e7;color:#2b2117;margin:0;padding:24px}
	.card{max-width:560px;margin:40px auto;background:#fffdf7;border:1px solid #d9c9a3;border-radius:10px;padding:28px;box-shadow:0 12px 40px rgba(60,40,10,.12)}
	h1{font-size:22px;color:#7b2d26;margin:0 0 6px} p{line-height:1.5}
	label{display:block;font-weight:600;margin:14px 0 4px}
	input{width:100%;box-sizing:border-box;font-size:15px;padding:10px 12px;border:1px solid #cbb98f;border-radius:6px;background:#fffef9}
	button{margin-top:18px;width:100%;font-size:16px;font-weight:700;padding:12px;border:0;border-radius:6px;background:#7b2d26;color:#fff;cursor:pointer}
	.err{background:#fdecea;border:1px solid #e5b4ae;color:#8c2f28;padding:10px 12px;border-radius:6px;margin-top:14px}
	.ok{background:#eef5e9;border:1px solid #b9d3ab;color:#2f5e26;padding:10px 12px;border-radius:6px;margin-top:14px}
	code{background:#f2ead8;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
	ol{padding-left:20px} li{margin:8px 0}
</style>
<div class="card">
<?php if ($done): ?>
	<h1>✅ Done — config.php is fixed</h1>
	<?php if ($imapNote): ?><div class="ok"><?php echo $imapNote; ?></div><?php endif; ?>
	<p>The email poller is configured and this setup page has <b>deleted itself</b>. Two last things:</p>
	<ol>
		<li><b>Cron job</b> — cPanel → Cron Jobs → Once Per Minute → command:<br><code><?php echo htmlspecialchars($cron); ?></code></li>
		<li><b>PhonePe Business</b> — Add Notification Receiver → Email → <code><?php echo htmlspecialchars($user); ?></code> (if not already done).</li>
	</ol>
	<p>Then pay ₹1 from another UPI account and check <code>data/mail-poller.log</code> — it should say <b>MATCHED</b>.</p>
<?php else: ?>
	<h1>7Pay — email poller setup</h1>
	<p>This patches <code>config.php</code> for the phone-free email poller. Your existing settings and secrets are kept; a backup is saved alongside.</p>
	<?php if ($err): ?><div class="err"><?php echo $err; ?></div><?php endif; ?>
	<form method="post" autocomplete="off">
		<label>Alert mailbox address</label>
		<input name="user" value="<?php echo htmlspecialchars((string)($_POST['user'] ?? 'upi-alerts@7by.in')); ?>">
		<label>Mailbox password</label>
		<input name="pass" type="password" value="">
		<label>Mail host (leave as-is unless login fails)</label>
		<input name="host" value="<?php echo htmlspecialchars((string)($_POST['host'] ?? 'localhost')); ?>">
		<button>Save &amp; finish</button>
	</form>
	<p style="font-size:13px;color:#6b5b41">Create the mailbox first: cPanel → Email Accounts → <b>upi-alerts@7by.in</b>. The password you set there is what goes above.</p>
<?php endif; ?>
</div>
