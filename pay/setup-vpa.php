<?php
/**
 * 7Pay — ONE-TIME setup page: set the UPI VPA buyers pay + live/test mode.
 *
 * Upload next to config.php, open  https://7pay.7by.in/setup-vpa.php ,
 * check the values, click Save — it patches config.php in place (backup kept)
 * and DELETES ITSELF. If you abandon setup, delete this file yourself.
 */

error_reporting(E_ALL & ~E_DEPRECATED);
$cfgFile = __DIR__ . '/config.php';
$GW = require $cfgFile;

$curVpa   = (string)($GW['upi']['vpa'] ?? '');
$curPayee = (string)($GW['upi']['payee'] ?? '7By');
$curMode  = (string)($GW['merchants']['7pay_7by']['mode'] ?? 'test');

$err = ''; $done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$vpa   = trim((string)($_POST['vpa'] ?? ''));
	$payee = trim((string)($_POST['payee'] ?? '')) ?: '7By';
	$mode  = ($_POST['mode'] ?? 'live') === 'live' ? 'live' : 'test';

	if (!preg_match('/^[\w.\-]{2,}@[a-zA-Z]{2,}$/', $vpa)) {
		$err = 'That does not look like a UPI ID (expected something like Q881078474@ybl).';
	} else {
		if (!isset($GW['upi']) || !is_array($GW['upi'])) $GW['upi'] = array();
		$GW['upi']['vpa']   = $vpa;
		$GW['upi']['payee'] = $payee;
		if (isset($GW['merchants']['7pay_7by'])) $GW['merchants']['7pay_7by']['mode'] = $mode;

		@copy($cfgFile, __DIR__ . '/config.backup-' . date('Ymd-His') . '.php');
		$out = "<?php\n/* 7Pay configuration — rewritten by setup-vpa.php on " . date('Y-m-d H:i')
			. " (a config.backup-*.php copy of the previous file is alongside). */\nreturn "
			. var_export($GW, true) . ";\n";
		$tmp = $cfgFile . '.new';
		if (@file_put_contents($tmp, $out) === false) $err = 'Could not write config (file permissions?).';
		else {
			$check = @include $tmp;
			if (!is_array($check) || ($check['upi']['vpa'] ?? '') !== $vpa) { @unlink($tmp); $err = 'Rewritten config failed verification — nothing was changed.'; }
			elseif (!@rename($tmp, $cfgFile)) { @unlink($tmp); $err = 'Could not replace config.php (file permissions?).'; }
			else { $done = true; @unlink(__FILE__); }
		}
	}
	$curVpa = $vpa ?: $curVpa; $curPayee = $payee; $curMode = $mode;
}
?><!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>7Pay — UPI setup</title>
<style>
	body{font-family:system-ui,sans-serif;background:#f6f1e7;color:#2b2117;margin:0;padding:24px}
	.card{max-width:560px;margin:40px auto;background:#fffdf7;border:1px solid #d9c9a3;border-radius:10px;padding:28px;box-shadow:0 12px 40px rgba(60,40,10,.12)}
	h1{font-size:22px;color:#7b2d26;margin:0 0 6px} p{line-height:1.5}
	label{display:block;font-weight:600;margin:14px 0 4px}
	input,select{width:100%;box-sizing:border-box;font-size:15px;padding:10px 12px;border:1px solid #cbb98f;border-radius:6px;background:#fffef9}
	button{margin-top:18px;width:100%;font-size:16px;font-weight:700;padding:12px;border:0;border-radius:6px;background:#7b2d26;color:#fff;cursor:pointer}
	.err{background:#fdecea;border:1px solid #e5b4ae;color:#8c2f28;padding:10px 12px;border-radius:6px;margin-top:14px}
	.ok{background:#eef5e9;border:1px solid #b9d3ab;color:#2f5e26;padding:10px 12px;border-radius:6px;margin-top:14px}
	code{background:#f2ead8;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
	.note{font-size:13px;color:#6b5b41}
</style>
<div class="card">
<?php if ($done): ?>
	<h1>✅ Done — UPI is set</h1>
	<div class="ok">Buyers now pay <code><?php echo htmlspecialchars($curVpa); ?></code> · mode: <b><?php echo htmlspecialchars($curMode); ?></b></div>
	<p>This setup page has <b>deleted itself</b>. Now do the real test: open a checkout on one of your tools (e.g. Get Pro on 7Solve), pay it from another UPI account, and it should complete by itself within a minute. Watch <code>data/mail-poller.log</code> for <b>MATCHED</b>.</p>
<?php else: ?>
	<h1>7Pay — set your UPI ID</h1>
	<p>This is the UPI ID buyers pay (your <b>PhonePe Business</b> VPA — the one that emails alerts to <code>upi-alerts@7by.in</code>).</p>
	<?php if ($err): ?><div class="err"><?php echo $err; ?></div><?php endif; ?>
	<form method="post" autocomplete="off">
		<label>UPI ID (VPA)</label>
		<input name="vpa" value="<?php echo htmlspecialchars($curVpa !== '' && strpos($curVpa, 'TODO') !== 0 ? $curVpa : 'Q881078474@ybl'); ?>">
		<label>Payee name shown in UPI apps</label>
		<input name="payee" value="<?php echo htmlspecialchars($curPayee); ?>">
		<label>Mode</label>
		<select name="mode">
			<option value="live" <?php echo $curMode === 'live' ? 'selected' : ''; ?>>live — real payments</option>
			<option value="test" <?php echo $curMode === 'test' ? 'selected' : ''; ?>>test — simulated only</option>
		</select>
		<p class="note">Current config: VPA <code><?php echo htmlspecialchars($curVpa === '' ? '(empty)' : $curVpa); ?></code> · mode <code><?php echo htmlspecialchars($curMode); ?></code></p>
		<button>Save &amp; finish</button>
	</form>
<?php endif; ?>
</div>
